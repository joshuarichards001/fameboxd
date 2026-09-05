// Tells IndexNow the site's pages changed — Bing, Yandex, Seznam, Naver and
// the AI search surfaces built on them. Google does not participate; use
// Search Console for that. Run via `npm run submit-indexnow`; the GitHub
// Action does it after the daily refresh commits. A rejected submission is a
// missed hint, not a broken site, so this never exits non-zero.
//
// It submits the URLs that actually changed, not the whole site: the refresh
// typically moves a few dozen pages out of several hundred, and submitting all
// of them daily is how a host gets its hints discounted. What changed comes
// from diffing the committed activity.json against its previous revision —
// the current one is read from disk, the previous from HEAD~1, which is the
// commit the Action checked out before the refresh committed on top of it.
//
// `--dry-run` prints the URL list and posts nothing.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
const ACTIVITY_PATH = repoPath("../src/data/activity.json");
const FILMS_TS_PATH = repoPath("../src/functions/films.ts");
// As git addresses it, which is not the same string as the paths above.
const ACTIVITY_IN_GIT = "src/data/activity.json";

const warn = (msg) => console.warn(`::warning::IndexNow: ${msg}`);

const url = (path) => `https://${HOST}${path}`;
// These mirror personPageUrl and filmPageUrl in src/functions/; this script
// runs outside the build and can't import the .ts modules.
const personUrl = (username) => url(`/people/${username}/`);
const filmUrl = (slug) => url(`/films/${slug}/`);

// The pages that list everybody: the directory, plus one page per tag in use
// (`${tag}s` is tagSlug in src/functions/tags.ts), plus the two indexes that
// move whenever any watch does. Used as the fallback whenever the diff can't
// be trusted to say what changed.
function coreUrls(people) {
	const tags = [...new Set(people.flatMap((p) => p.tags))].sort();
	return [
		url("/"),
		url("/recent/"),
		url("/films/"),
		...tags.map((tag) => url(`/${tag}s/`)),
	];
}

// activity.json as of the previous commit, or null when there isn't one — a
// first run, a shallow clone with no parent, or a commit that predates the
// file. Callers fall back to the core pages rather than guessing.
function previousActivity() {
	try {
		return JSON.parse(
			execFileSync("git", ["show", `HEAD~1:${ACTIVITY_IN_GIT}`], {
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
				stdio: ["ignore", "pipe", "ignore"],
			}),
		);
	} catch {
		return null;
	}
}

// The film-page threshold lives in src/functions/films.ts, and the router
// obeys it. Read it from there rather than duplicating the number here, where
// a stale copy would mean submitting URLs that 404. Null (with a warning) if
// it can't be read: skipping the film pages costs a hint, guessing costs
// credibility.
async function filmPageMinWatchers() {
	const source = await readFile(FILMS_TS_PATH, "utf8");
	const match = source.match(/FILM_PAGE_MIN_WATCHERS\s*=\s*(\d+)/);
	if (!match) {
		warn("couldn't read FILM_PAGE_MIN_WATCHERS from films.ts; skipping films");
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
async function changedUrls(previous, current, people) {
	const usernames = new Set([
		...Object.keys(previous.people),
		...Object.keys(current.people),
	]);
	const changed = [...usernames].filter(
		(username) =>
			personKey(entriesFor(previous, username)) !==
			personKey(entriesFor(current, username)),
	);

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

	// The directory and the recency feed list everyone's newest watch, so they
	// move whenever anything does.
	const urls = new Set([url("/"), url("/recent/")]);
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
	const current = JSON.parse(await readFile(ACTIVITY_PATH, "utf8"));
	const previous = previousActivity();

	let urlList;
	if (!previous) {
		warn("no previous activity.json; submitting the core pages only");
		urlList = coreUrls(people);
	} else {
		urlList = await changedUrls(previous, current, people);
		if (urlList.length > MAX_URLS) {
			warn(
				`${urlList.length} URLs changed (cap ${MAX_URLS}); submitting the core pages only`,
			);
			urlList = coreUrls(people);
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
