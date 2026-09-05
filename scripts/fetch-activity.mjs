// Fetches each person's Letterboxd diary from the public RSS feed. Writes two
// files: the full entry list (up to 200 per person) to src/data/activity.json,
// and the most recent watch to the `lastWatched` field of src/data/people.json.
// Run via `npm run fetch-activity`; the GitHub Action does this daily. The
// build never fetches — it only reads the committed JSON, so a Letterboxd
// outage can't break deploys.
//
// The feed returns the ~50 most recently logged entries, so activity.json is
// merged rather than overwritten: entries older than the feed's window are
// kept, entries inside it are replaced wholesale (so deletions propagate).
//
// activity.json is written normalized — film titles held once in `films`,
// entries one per line — see ActivityFile in src/functions/activity.ts. Merging
// happens on the flat entries, so this script hydrates on read and packs on
// write; nothing in between needs to know the stored shape.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PEOPLE_PATH = fileURLToPath(
	new URL("../src/data/people.json", import.meta.url),
);
const ACTIVITY_PATH = fileURLToPath(
	new URL("../src/data/activity.json", import.meta.url),
);

const UA = "fameboxd/1.0 (+https://fameboxd.com)";
const CONCURRENCY = 4;
const MAX_ENTRIES = 200;

const decode = (s) =>
	s
		.replace(/&#0?39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const serialize = (data) => JSON.stringify(data, null, "  ") + "\n";

// Flat entries -> the stored shape. Film metadata is deduplicated into `films`;
// entries keep one line each, so a new watch stays a one-line commit diff.
function packActivity(generatedAt, byUsername) {
	const films = {};
	const people = {};
	for (const username of Object.keys(byUsername).sort()) {
		people[username] = byUsername[username].map((e) => {
			const seen = films[e.slug];
			if (!seen) films[e.slug] = [e.title, e.year ?? null, e.tmdb ?? null];
			// An entry that predates tmdb ids in the feed shouldn't blank one we
			// already have, so only fill the gap.
			else if (seen[2] == null && e.tmdb != null) seen[2] = e.tmdb;
			const packed = { s: e.slug, d: e.watchedDate ?? null, r: e.rating ?? null };
			if (e.rewatch) packed.w = 1;
			if (e.liked) packed.l = 1;
			return packed;
		});
	}
	const j = JSON.stringify;
	const filmLines = Object.keys(films)
		.sort()
		.map((slug) => `    ${j(slug)}: ${j(films[slug])}`);
	const peopleLines = Object.entries(people).map(
		([username, entries]) =>
			`    ${j(username)}: [\n${entries.map((e) => `      ${j(e)}`).join(",\n")}\n    ]`,
	);
	return `{\n  ${j("generatedAt")}: ${j(generatedAt)},\n  ${j("films")}: {\n${filmLines.join(",\n")}\n  },\n  ${j("people")}: {\n${peopleLines.join(",\n")}\n  }\n}\n`;
}

// The stored shape -> flat entries, mirroring loadActivity in activity.ts.
function unpackActivity(file) {
	const out = {};
	for (const [username, entries] of Object.entries(file?.people ?? {})) {
		out[username] = entries.map((e) => {
			const [title, year, tmdb] = file.films[e.s] ?? [e.s, null, null];
			return {
				slug: e.s,
				title,
				year,
				tmdb,
				watchedDate: e.d ?? null,
				rating: e.r ?? null,
				rewatch: e.w === 1,
				liked: e.l === 1,
			};
		});
	}
	return out;
}

async function get(url) {
	const res = await fetch(url, { headers: { "user-agent": UA } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.text();
}

// Every diary entry in the feed, in feed order (most recently *logged* first).
// The feed also carries list updates, which the guid guard filters out.
function parseDiary(xml) {
	const entries = [];
	for (const [, item] of xml.matchAll(/<item>(.*?)<\/item>/gs)) {
		if (!/letterboxd-(?:watch|review)-/.test(item)) continue;
		const tag = (name) =>
			item.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
		const title = tag("letterboxd:filmTitle");
		// The film slug is our join key, so an entry without one is unusable.
		const slug = tag("link")?.match(/\/film\/([^/]+)\//)?.[1];
		if (!title || !slug) continue;
		const year = tag("letterboxd:filmYear");
		const tmdb = tag("tmdb:movieId");
		const rating = tag("letterboxd:memberRating");
		entries.push({
			slug,
			title: decode(title),
			year: year ? Number(year) : null,
			tmdb: tmdb ? Number(tmdb) : null,
			watchedDate: tag("letterboxd:watchedDate") ?? null,
			rating: rating ? Number(rating) : null,
			rewatch: tag("letterboxd:rewatch") === "Yes",
			liked: tag("letterboxd:memberLike") === "Yes",
		});
	}
	return entries;
}

// Newest watch first. Stable, so entries sharing a date keep feed order.
const byWatchedDateDesc = (a, b) =>
	(b.watchedDate ?? "").localeCompare(a.watchedDate ?? "");

// The feed is authoritative for the date range it covers; anything older is
// history we'd otherwise lose, since it has rolled off the 50-entry window.
function mergeEntries(fresh, previous) {
	if (fresh.length === 0) return previous;
	const sorted = [...fresh].sort(byWatchedDateDesc);
	const oldest = sorted.findLast((e) => e.watchedDate)?.watchedDate;
	const kept = oldest
		? previous.filter((e) => e.watchedDate && e.watchedDate < oldest)
		: [];
	return [...sorted, ...kept].slice(0, MAX_ENTRIES);
}

async function main() {
	const before = await readFile(PEOPLE_PATH, "utf8");
	const people = JSON.parse(before);
	const beforeActivity = await readFile(ACTIVITY_PATH, "utf8").catch(() => null);
	const prevActivity = beforeActivity ? JSON.parse(beforeActivity) : null;
	const previous = unpackActivity(prevActivity);

	let failures = 0;
	const fresh = new Map();
	const queue = [...people];

	async function worker() {
		for (let p = queue.shift(); p; p = queue.shift()) {
			try {
				const rss = await get(`https://letterboxd.com/${p.username}/rss/`);
				const entries = parseDiary(rss);
				fresh.set(p.username, entries);
				// Feed order, not watched-date order: `lastWatched` has always
				// meant the most recently logged watch, and the card and the
				// homepage sort read it.
				const latest = entries[0];
				p.lastWatched = latest
					? {
							title: latest.title,
							date: latest.watchedDate,
							rating: latest.rating,
						}
					: null;
				console.log(`ok    ${p.username} (${entries.length})`);
			} catch (err) {
				// Keep whatever (stale) data the person already has.
				failures++;
				console.warn(`FAIL  ${p.username}: ${err.message}`);
			}
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	if (failures === people.length) {
		console.error("Every fetch failed — refusing to write.");
		process.exit(1);
	}

	// Keys alphabetical and entries newest-first, so the daily commit only
	// touches the lines that actually changed. People with no diary are omitted.
	const merged = {};
	for (const username of people.map((p) => p.username).sort()) {
		const entries = fresh.has(username)
			? mergeEntries(fresh.get(username), previous[username] ?? [])
			: (previous[username] ?? []);
		if (entries.length > 0) merged[username] = entries;
	}

	// Compare against the old timestamp, so an unchanged diary is a no-op
	// rather than a daily one-line commit.
	const candidate = packActivity(prevActivity?.generatedAt ?? "", merged);
	if (candidate === beforeActivity) {
		console.log("No diary changes; leaving activity.json untouched.");
	} else {
		await writeFile(
			ACTIVITY_PATH,
			packActivity(new Date().toISOString(), merged),
		);
		const total = Object.values(merged).reduce((n, e) => n + e.length, 0);
		console.log(
			`Wrote activity.json: ${Object.keys(merged).length} people, ${total} entries.`,
		);
	}

	const after = serialize(people);
	if (after === before) {
		console.log("No changes since last fetch; leaving people.json untouched.");
		return;
	}
	await writeFile(PEOPLE_PATH, after);
	console.log(
		`Updated lastWatched for ${people.length - failures}/${people.length} people (${failures} failures).`,
	);
}

await main();
