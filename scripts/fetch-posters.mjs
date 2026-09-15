// Fills in the poster for every film in src/data/films.json that hasn't got
// one. Run via `npm run fetch-posters`; the daily GitHub Action runs it after
// fetch-activity.mjs, which is what adds the films that land here with a null
// poster.
//
// fetch-activity gets a poster free for entries still inside a diary feed's
// ~50-entry window — the feed puts it in the entry's description — but that is
// only ever a slice of the catalogue, and nothing at all for a film last
// watched years ago. The film's own page carries it for everyone else: its
// JSON-LD Movie node has an `image`, which is the same CDN URL in the same
// shape, so the two sources agree and neither needs the other's format.
//
// Letterboxd's robots.txt allows /film/<slug>/ for a named agent like ours
// (only the AI scrapers it lists are blanket-disallowed), and unlike a member
// profile — which Cloudflare answers with a 403 whatever headers you send — a
// film page is served normally.
//
// The run is incremental: after the first pass fills the catalogue, each later
// run only fetches the handful of films somebody watched for the first time.
// Pass --min-watchers=N to restrict a run to films logged by at least N distinct
// people. Per-film failures leave the poster null so the next run retries it,
// and nothing is ever overwritten, so a poster only gets fetched once.

import { posterBase, readFilms, writeFilms } from "./films-file.mjs";
import { readPeopleFiles } from "./people-files.mjs";

const UA = "fameboxd/1.0 (+https://fameboxd.com)";
const CONCURRENCY = 4;
// The first pass over an empty catalogue is thousands of films and takes
// minutes, so it checkpoints rather than writing once at the end: an
// interrupted run keeps what it fetched, and the next one picks up the rest.
const CHECKPOINT_EVERY = 250;
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;
if (!(limit > 0 && (Number.isInteger(limit) || limit === Infinity))) {
	throw new Error("--limit must be a positive integer");
}
const minWatchersArg = process.argv.find((arg) =>
	arg.startsWith("--min-watchers="),
);
const minWatchers = minWatchersArg ? Number(minWatchersArg.slice(15)) : 0;
if (!(Number.isInteger(minWatchers) && minWatchers >= 0)) {
	throw new Error("--min-watchers must be a non-negative integer");
}

async function slugsWithMinimumWatchers(minimum) {
	if (minimum === 0) return null;
	const people = await readPeopleFiles();
	const watchers = new Map();
	for (const diary of Object.values(people)) {
		for (const slug of new Set(diary.entries.map((entry) => entry.s))) {
			watchers.set(slug, (watchers.get(slug) ?? 0) + 1);
		}
	}
	return new Set(
		[...watchers].filter(([, count]) => count >= minimum).map(([slug]) => slug),
	);
}

// The film page's JSON-LD Movie node. It sits in a CDATA wrapper, which JSON
// won't parse, so that comes off first.
function posterFromPage(html) {
	for (const [, block] of html.matchAll(
		/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
	)) {
		const json = block
			.replace("/* <![CDATA[ */", "")
			.replace("/* ]]> */", "")
			.trim();
		try {
			const base = posterBase(JSON.parse(json).image);
			if (base) return base;
		} catch {
			// Not the node we want, or not JSON at all. Try the next one.
		}
	}
	return null;
}

async function main() {
	const films = await readFilms();
	const eligible = await slugsWithMinimumWatchers(minWatchers);
	const missingFilms = Object.keys(films).filter(
		(slug) => films[slug][3] == null && (eligible == null || eligible.has(slug)),
	);
	// Rotate limited daily batches so a permanently missing poster cannot
	// prevent later slugs from ever being attempted.
	const start = Number.isFinite(limit) && missingFilms.length
		? (Math.floor(Date.now() / 86400000) * limit) % missingFilms.length
		: 0;
	const queue = Number.isFinite(limit)
		? [...missingFilms.slice(start), ...missingFilms.slice(0, start)].slice(0, limit)
		: missingFilms;
	if (queue.length === 0) {
		console.log(
			minWatchers > 0
				? `Every film with at least ${minWatchers} watchers already has a poster.`
				: "Every film already has a poster.",
		);
		return;
	}
	console.log(
		`Fetching ${queue.length} posters${minWatchers > 0 ? ` for films with at least ${minWatchers} watchers` : ""}...`,
	);

	let done = 0;
	let filled = 0;
	let failures = 0;
	const missing = [];

	async function worker() {
		for (let slug = queue.shift(); slug; slug = queue.shift()) {
			try {
				const res = await fetch(`https://letterboxd.com/film/${slug}/`, {
					headers: { "user-agent": UA },
				});
				if (!res.ok) throw new Error(`${res.status}`);
				const poster = posterFromPage(await res.text());
				if (poster) {
					films[slug][3] = poster;
					filled++;
				} else {
					// The page loaded and has no poster on it. Left null, so the next
					// run asks again — Letterboxd does add artwork to bare entries.
					missing.push(slug);
				}
			} catch (err) {
				failures++;
				console.warn(`FAIL  ${slug}: ${err.message}`);
			}
			// One line per film would bury the failures above in 3,700 lines of ok.
			if (++done % 100 === 0) console.log(`  ${done} fetched, ${filled} filled`);
			if (filled > 0 && filled % CHECKPOINT_EVERY === 0) await writeFilms(films);
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	if (filled === 0) {
		console.log("Nothing filled in; leaving films.json untouched.");
		return;
	}
	await writeFilms(films);
	const left = Object.values(films).filter((f) => f[3] == null).length;
	console.log(
		`Filled ${filled} posters (${failures} failed, ${missing.length} have none). ${left} still without one.`,
	);
}

await main();
