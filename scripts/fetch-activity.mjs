// Fetches each person's most recent Letterboxd diary entry (title, watched
// date, rating) from the public RSS feed into the `lastWatched` field of
// src/data/people.json. Run via `npm run fetch-activity`; the GitHub Action
// does this daily. The build never fetches — it only reads the committed
// JSON, so a Letterboxd outage can't break deploys.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PEOPLE_PATH = fileURLToPath(
	new URL("../src/data/people.json", import.meta.url),
);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const CONCURRENCY = 4;

const decode = (s) =>
	s
		.replace(/&#0?39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

async function get(url) {
	const res = await fetch(url, { headers: { "user-agent": UA } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.text();
}

// First diary entry in the feed (the feed also carries list updates etc.).
function parseLastWatched(xml) {
	for (const [, item] of xml.matchAll(/<item>(.*?)<\/item>/gs)) {
		if (!/letterboxd-(?:watch|review)-/.test(item)) continue;
		const tag = (name) =>
			item.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
		const title = tag("letterboxd:filmTitle");
		if (!title) continue;
		const rating = tag("letterboxd:memberRating");
		return {
			title: decode(title),
			date: tag("letterboxd:watchedDate") ?? null,
			rating: rating ? Number(rating) : null,
		};
	}
	return null;
}

async function main() {
	const before = await readFile(PEOPLE_PATH, "utf8");
	const people = JSON.parse(before);

	let failures = 0;
	const queue = [...people];

	async function worker() {
		for (let p = queue.shift(); p; p = queue.shift()) {
			try {
				const rss = await get(`https://letterboxd.com/${p.username}/rss/`);
				p.lastWatched = parseLastWatched(rss);
				console.log(`ok    ${p.username}`);
			} catch (err) {
				// Keep whatever (stale) lastWatched the entry already has.
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

	const after = JSON.stringify(people, null, "  ") + "\n";
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
