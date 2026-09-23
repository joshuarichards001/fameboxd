// Tells IndexNow the site's pages changed — Bing, Yandex, Seznam, Naver and
// the AI search surfaces built on them. Google does not participate; use
// Search Console for that. Run via `npm run submit-indexnow`; the GitHub
// Action does it after the daily refresh commits. A rejected submission is a
// missed hint, not a broken site, so this never exits non-zero.
//
// It submits the URLs that actually changed, not the whole site: the refresh
// typically moves a few dozen pages out of several hundred, and submitting all
// of them daily is how a host gets its hints discounted. What changed comes
// from diffing committed per-person diaries against their previous revision —
// current files are read from disk, previous files from HEAD~1, which is the
// commit the Action checked out before the refresh committed on top of it.
//
// `--dry-run` prints the URL list and posts nothing.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readPeopleFiles } from "./people-files.mjs";

const HOST = "fameboxd.com";
// Public by design — IndexNow verifies ownership by fetching keyLocation and
// checking it contains this string. Renaming one means renaming both.
const KEY = "b0c6206aaa89475260c76f58183b3566";

// A refresh that moves more than this many pages is not a normal day's watches
// — more likely a bulk edit or a re-fetch of everything — and dumping it on
// IndexNow is the submission most likely to be treated as spam. Fall back to
// the core pages and say so.
const MAX_URLS = 200;

const DRY_RUN = process.argv.includes("--dry-run");

const repoPath = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const PEOPLE_PATH = repoPath("../src/data/people.json");
const FILMS_TS_PATH = repoPath("../src/functions/film-constants.ts");
const RANKINGS_TS_PATH = repoPath("../src/functions/rankings.ts");
// As git addresses it, which is not the same string as the paths above.
const DIARIES_IN_GIT = "src/data/people";

const warn = (msg) => console.warn(`::warning::IndexNow: ${msg}`);

const url = (path) => `https://${HOST}${path}`;
// These mirror personPageUrl and filmPageUrl in src/functions/; this script
// runs outside the build and can't import the .ts modules.
const personUrl = (username) => url(`/people/${username}/`);
const filmUrl = (slug) => url(`/films/${slug}/`);
const rankingsUrl = (year) =>
	year == null ? url("/rankings/") : url(`/rankings/year/${year}/`);

// The pages that list everybody: the directory, plus one page per tag in use
// (`${tag}s` is tagSlug in src/functions/tags.ts), plus the indexes that
// move whenever any watch does. Used as the fallback whenever the diff can't
// be trusted to say what changed.
function coreUrls(people, years = []) {
	const tags = [...new Set(people.flatMap((p) => p.tags))].sort();
	return [
		url("/"),
		url("/recent/"),
		url("/films/"),
		rankingsUrl(),
		...years.map((year) => rankingsUrl(year)),
		...tags.map((tag) => url(`/${tag}s/`)),
	];
}

// Per-person diaries as of the previous commit, or null when there aren't any — a
// first run, a shallow clone with no parent, or a commit that predates the
// file. Callers fall back to the core pages rather than guessing.
function previousActivity() {
	try {
		const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD~1", DIARIES_IN_GIT], {
			encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
		}).trim().split("\n").filter((path) => path.endsWith(".json"));
		if (!paths.length) return null;
		const people = {};
		const generatedAt = [];
		for (const path of paths) {
			const file = JSON.parse(execFileSync("git", ["show", `HEAD~1:${path}`], {
				encoding: "utf8",
				maxBuffer: 16 * 1024 * 1024,
				stdio: ["ignore", "pipe", "ignore"],
			}));
			people[path.split("/").at(-1).slice(0, -5)] = file.entries;
			generatedAt.push(file.generatedAt);
		}
		return { generatedAt: generatedAt.sort().at(-1) ?? "", people };
	} catch {
		return null;
	}
}

async function rankingThresholds() {
	const source = await readFile(RANKINGS_TS_PATH, "utf8");
	const people = source.match(/YEAR_MIN_ACTIVE_PEOPLE\s*=\s*([\d_]+)/);
	const entries = source.match(/YEAR_MIN_ENTRIES\s*=\s*([\d_]+)/);
	if (!people || !entries) {
		warn("couldn't read ranking year thresholds; skipping ranking year pages");
		return null;
	}
	return {
		people: Number(people[1].replaceAll("_", "")),
		entries: Number(entries[1].replaceAll("_", "")),
	};
}

function qualifyingYears(file, thresholds) {
	if (!thresholds) return new Set();
	const cutoff = file.generatedAt.slice(0, 10);
	const years = new Map();
	for (const [username, entries] of Object.entries(file.people)) {
		for (const entry of entries) {
			if (!entry.d || entry.d > cutoff) continue;
			const year = entry.d.slice(0, 4);
			const bucket = years.get(year) ?? { entries: 0, people: new Set() };
			bucket.entries++;
			bucket.people.add(username);
			years.set(year, bucket);
		}
	}
	return new Set([...years].filter(([, bucket]) =>
		bucket.entries >= thresholds.entries && bucket.people.size >= thresholds.people
	).map(([year]) => year));
}

// The film-page threshold lives in src/functions/film-constants.ts, and the router
// obeys it. Read it from there rather than duplicating the number here, where
// a stale copy would mean submitting URLs that 404. Null (with a warning) if
// it can't be read: skipping the film pages costs a hint, guessing costs
// credibility.
async function filmPageMinWatchers() {
	const source = await readFile(FILMS_TS_PATH, "utf8");
	const match = source.match(/FILM_PAGE_MIN_WATCHERS\s*=\s*(\d+)/);
	if (!match) {
		warn("couldn't read FILM_PAGE_MIN_WATCHERS from film-constants.ts; skipping films");
		return null;
	}
	return Number(match[1]);
}

const entriesFor = (file, username) => file.people[username] ?? [];

// A person's entries as one comparable string. The person page renders all of
// them, so any edit anywhere in the list changes that page.
const personKey = (entries) => JSON.stringify(entries);

// The same collapse the film pages do: a person who logged a film three times
// is one watcher, carrying their most recent entry (entries are newest-first).
function bySlug(entries) {
	const seen = new Map();
	for (const entry of entries) {
		if (!seen.has(entry.s)) seen.set(entry.s, JSON.stringify(entry));
	}
	return seen;
}

// How many people logged each film, in one revision of the file.
function watcherCounts(file) {
	const counts = new Map();
	for (const entries of Object.values(file.people)) {
		for (const slug of new Set(entries.map((e) => e.s))) {
			counts.set(slug, (counts.get(slug) ?? 0) + 1);
		}
	}
	return counts;
}

// The URLs whose content moved between the two revisions.
async function changedUrls(previous, current, people, rankingThreshold) {
	const usernames = new Set([
		...Object.keys(previous.people),
		...Object.keys(current.people),
	]);
	const changed = [...usernames].filter(
		(username) =>
			personKey(entriesFor(previous, username)) !==
			personKey(entriesFor(current, username)),
	);
	const qualifying = new Set([
		...qualifyingYears(previous, rankingThreshold),
		...qualifyingYears(current, rankingThreshold),
	]);
	const changedYears = new Set();
	for (const username of changed) {
		const before = entriesFor(previous, username);
		const after = entriesFor(current, username);
		const years = new Set([
			...before.map((entry) => entry.d?.slice(0, 4)).filter(Boolean),
			...after.map((entry) => entry.d?.slice(0, 4)).filter(Boolean),
		]);
		for (const year of years) {
			const beforeYear = before.filter((entry) => entry.d?.startsWith(`${year}-`));
			const afterYear = after.filter((entry) => entry.d?.startsWith(`${year}-`));
			if (JSON.stringify(beforeYear) !== JSON.stringify(afterYear)) changedYears.add(year);
		}
	}

	// Which films those people's changes touched — added, removed or edited.
	const slugs = new Set();
	for (const username of changed) {
		const before = bySlug(entriesFor(previous, username));
		const after = bySlug(entriesFor(current, username));
		for (const slug of new Set([...before.keys(), ...after.keys()])) {
			if (before.get(slug) !== after.get(slug)) slugs.add(slug);
		}
	}

	// Only the ones with a page. Either revision qualifying is enough: a film
	// that just crossed the threshold has a new page, and one that fell below
	// it has a URL that now 404s, which is how IndexNow is told a page is gone.
	const min = await filmPageMinWatchers();
	const films = [];
	if (min != null) {
		const before = watcherCounts(previous);
		const after = watcherCounts(current);
		for (const slug of slugs) {
			if ((before.get(slug) ?? 0) >= min || (after.get(slug) ?? 0) >= min) {
				films.push(slug);
			}
		}
	}

	// The directory, recent page and all-time rankings change with the diaries.
	const urls = new Set([url("/"), url("/recent/")]);
	if (changed.length > 0) urls.add(rankingsUrl());
	for (const year of [...changedYears].filter((year) => qualifying.has(year)).sort()) {
		urls.add(rankingsUrl(year));
	}
	const byUsername = new Map(people.map((p) => [p.username, p]));
	for (const username of changed) {
		urls.add(personUrl(username));
		// The tag pages that person appears on are filtered views of the same
		// cards, so their newest watch moved too.
		for (const tag of byUsername.get(username)?.tags ?? []) {
			urls.add(url(`/${tag}s/`));
		}
	}
	// /films/ lists every film page with its watcher count, so it moves exactly
	// when one of those pages does.
	if (films.length > 0) urls.add(url("/films/"));
	for (const slug of films.sort()) urls.add(filmUrl(slug));

	return [...urls];
}

async function main() {
	const people = JSON.parse(await readFile(PEOPLE_PATH, "utf8"));
	const currentFiles = await readPeopleFiles();
	const current = {
		generatedAt: Object.values(currentFiles).map((file) => file.generatedAt).sort().at(-1) ?? "",
		people: Object.fromEntries(Object.entries(currentFiles).map(([username, file]) => [username, file.entries])),
	};
	const previous = previousActivity();
	const thresholds = await rankingThresholds();
	const currentYears = [...qualifyingYears(current, thresholds)].sort().reverse();

	let urlList;
	if (!previous) {
		warn("no previous per-person diaries; submitting the core pages only");
		urlList = coreUrls(people, currentYears);
	} else {
		urlList = await changedUrls(previous, current, people, thresholds);
		if (urlList.length > MAX_URLS) {
			warn(
				`${urlList.length} URLs changed (cap ${MAX_URLS}); submitting the core pages only`,
			);
			urlList = coreUrls(people, currentYears);
		}
	}

	for (const u of urlList) console.log(u);
	if (DRY_RUN) {
		console.log(`Dry run: ${urlList.length} URLs, nothing submitted.`);
		return;
	}

	const res = await fetch("https://api.indexnow.org/indexnow", {
		method: "POST",
		headers: { "content-type": "application/json; charset=utf-8" },
		body: JSON.stringify({
			host: HOST,
			key: KEY,
			keyLocation: `https://${HOST}/${KEY}.txt`,
			urlList,
		}),
	});

	// 200 accepted, 202 accepted but the key is still being verified.
	if (res.status !== 200 && res.status !== 202) {
		warn(`${res.status} ${res.statusText} — ${(await res.text()).trim()}`);
		return;
	}
	console.log(`Submitted ${urlList.length} URLs (${res.status}).`);
}

try {
	await main();
} catch (err) {
	warn(err.message);
}
