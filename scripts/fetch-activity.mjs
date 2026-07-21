// Fetches each person's recent watches (RSS) and favorite films (profile
// scrape) from Letterboxd into src/data/activity.json. Run via
// `npm run fetch-activity`; the GitHub Action does this daily. The build
// never fetches — it only reads the committed JSON, so a Letterboxd outage
// can't break deploys.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const OUT_PATH = fileURLToPath(
	new URL("../src/data/activity.json", import.meta.url),
);
const PEOPLE_PATH = fileURLToPath(
	new URL("../src/data/people.json", import.meta.url),
);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const CONCURRENCY = 4;
const MAX_ITEMS = 4;

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

// --- Recent watches, from the public RSS feed -------------------------------

function parseRecent(xml) {
	const items = [];
	for (const [, item] of xml.matchAll(/<item>(.*?)<\/item>/gs)) {
		// Diary entries only; the feed also carries list updates etc.
		if (!/letterboxd-(?:watch|review)-/.test(item)) continue;
		const tag = (name) =>
			item.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
		const title = tag("letterboxd:filmTitle");
		if (!title) continue;
		const rating = tag("letterboxd:memberRating");
		items.push({
			title: decode(title),
			year: tag("letterboxd:filmYear") ?? null,
			rating: rating ? Number(rating) : null,
			watchedDate: tag("letterboxd:watchedDate") ?? null,
			url: tag("link") ?? null,
			poster: item.match(/<img src="(https:\/\/a\.ltrbxd\.com[^"]+)"/)?.[1] ?? null,
		});
		if (items.length === MAX_ITEMS) break;
	}
	return items;
}

// --- Favorite films, from the profile page ----------------------------------

function parseFavorites(html) {
	const start = html.indexOf('id="favourites"');
	if (start === -1) return [];
	const section = html.slice(start, html.indexOf("</section>", start));
	const favs = [];
	for (const [, div] of section.matchAll(/<div class="react-component"([^>]*)>/g)) {
		const attr = (name) => div.match(new RegExp(`data-item-${name}="([^"]*)"`))?.[1];
		const name = attr("name");
		const slug = attr("slug");
		if (!name || !slug) continue;
		favs.push({
			title: decode(name),
			slug,
			url: `https://letterboxd.com/film/${slug}/`,
			poster: null, // filled in below, from cache or the film page
		});
		if (favs.length === MAX_ITEMS) break;
	}
	return favs;
}

// Favorite posters are lazy-loaded on the profile, but the film page HTML
// contains the real CDN URL. Posters basically never change, so cache them
// by slug across runs to keep the daily fetch small.
async function fetchPoster(slug) {
	const html = await get(`https://letterboxd.com/film/${slug}/`);
	// The JSON-LD block's "image" is the poster for both Letterboxd-hosted
	// (film-poster/...) and TMDB-sourced (sm/upload/...) art. Fall back to a
	// bare film-poster CDN path if the block is missing.
	const ld = html.match(/"image":"(https:\/\/a\.ltrbxd\.com\/resized\/[^"]+)"/)?.[1];
	if (ld) return ld;
	const path = html.match(/film-poster\/[^"'\s]+?\.jpg\?v=\w+/)?.[0];
	return path ? `https://a.ltrbxd.com/resized/${path}` : null;
}

// --- Main -------------------------------------------------------------------

async function main() {
	const people = JSON.parse(await readFile(PEOPLE_PATH, "utf8"));
	let previous = { people: {} };
	try {
		previous = JSON.parse(await readFile(OUT_PATH, "utf8"));
	} catch {
		// first run
	}

	const posterCache = new Map();
	for (const entry of Object.values(previous.people ?? {})) {
		for (const f of entry.favorites ?? []) {
			if (f.slug && f.poster) posterCache.set(f.slug, f.poster);
		}
	}

	const results = {};
	let failures = 0;
	const queue = [...people];

	async function worker() {
		for (let p = queue.shift(); p; p = queue.shift()) {
			try {
				const [rss, profile] = await Promise.all([
					get(`https://letterboxd.com/${p.username}/rss/`),
					get(`https://letterboxd.com/${p.username}/`),
				]);
				const favorites = parseFavorites(profile);
				for (const f of favorites) {
					if (!posterCache.has(f.slug)) {
						try {
							const poster = await fetchPoster(f.slug);
							if (!poster) console.warn(`      no poster match for ${f.slug}`);
							posterCache.set(f.slug, poster);
						} catch (err) {
							console.warn(`      poster fetch failed for ${f.slug}: ${err.message}`);
							posterCache.set(f.slug, null);
						}
					}
					f.poster = posterCache.get(f.slug);
				}
				results[p.username] = { recent: parseRecent(rss), favorites };
				console.log(`ok    ${p.username}`);
			} catch (err) {
				failures++;
				const stale = previous.people?.[p.username];
				if (stale) results[p.username] = stale;
				console.warn(`FAIL  ${p.username}: ${err.message}${stale ? " (kept stale data)" : ""}`);
			}
		}
	}

	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	if (failures === people.length) {
		console.error("Every fetch failed — refusing to write.");
		process.exit(1);
	}

	const sorted = Object.fromEntries(
		Object.keys(results)
			.sort()
			.map((k) => [k, results[k]]),
	);
	if (JSON.stringify(sorted) === JSON.stringify(previous.people)) {
		console.log("No changes since last fetch; leaving activity.json untouched.");
		return;
	}
	await writeFile(
		OUT_PATH,
		JSON.stringify({ generatedAt: new Date().toISOString(), people: sorted }, null, "\t") + "\n",
	);
	console.log(
		`Wrote activity for ${Object.keys(sorted).length}/${people.length} people (${failures} failures).`,
	);
}

await main();
