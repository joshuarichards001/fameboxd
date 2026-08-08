// Fetches each person's Letterboxd follower count into the `followers` field
// of src/data/people.json. Run via `npm run fetch-followers`; the GitHub
// Action does this weekly. The build never fetches — it only reads the
// committed JSON, so a Letterboxd outage can't break deploys.
//
// The count comes from the followers page's sub-nav tooltip
// (`title="493,432 people"`), which carries the exact number. The profile page
// itself is Cloudflare-blocked (403) to plain clients no matter what headers
// you send, so don't scrape that; the followers page isn't blocked.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PEOPLE_PATH = fileURLToPath(
	new URL("../src/data/people.json", import.meta.url),
);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const CONCURRENCY = 4;

async function get(url) {
	const res = await fetch(url, { headers: { "user-agent": UA } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.text();
}

// <a href="/<username>/followers/" class="tooltip" title="493,432&nbsp;people">
// The tooltip is omitted when nobody follows them.
function parseFollowers(html, username) {
	const link = html.match(
		new RegExp(`<a href="/${username}/followers/"([^>]*)>`),
	);
	if (!link) throw new Error("no followers link in page");
	const count = link[1].match(/title="([\d,]+)(?:&nbsp;|\s)/);
	return count ? Number(count[1].replace(/,/g, "")) : 0;
}

async function main() {
	const before = await readFile(PEOPLE_PATH, "utf8");
	const people = JSON.parse(before);

	let failures = 0;
	const queue = [...people];

	async function worker() {
		for (let p = queue.shift(); p; p = queue.shift()) {
			try {
				const html = await get(
					`https://letterboxd.com/${p.username}/followers/`,
				);
				p.followers = parseFollowers(html, p.username);
				console.log(`ok    ${p.username} ${p.followers}`);
			} catch (err) {
				// Keep whatever (stale) count the entry already has.
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
		`Updated followers for ${people.length - failures}/${people.length} people (${failures} failures).`,
	);
}

await main();
