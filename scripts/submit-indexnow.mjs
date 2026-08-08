// Tells IndexNow the site's pages changed — Bing, Yandex, Seznam, Naver and
// the AI search surfaces built on them. Google does not participate; use
// Search Console for that. Run via `npm run submit-indexnow`; the GitHub
// Action does it after the daily refresh commits. A rejected submission is a
// missed hint, not a broken site, so this never exits non-zero.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HOST = "fameboxd.com";
// Public by design — IndexNow verifies ownership by fetching keyLocation and
// checking it contains this string. Renaming one means renaming both.
const KEY = "b0c6206aaa89475260c76f58183b3566";

const PEOPLE_PATH = fileURLToPath(
	new URL("../src/data/people.json", import.meta.url),
);

const warn = (msg) => console.warn(`::warning::IndexNow: ${msg}`);

async function main() {
	const people = JSON.parse(await readFile(PEOPLE_PATH, "utf8"));
	// The same URL set the sitemap lists: the directory, plus one page per tag
	// in use (see astro.config.mjs and pages/[tag].astro).
	const tags = [...new Set(people.flatMap((p) => p.tags))].sort();
	const urlList = [
		`https://${HOST}/`,
		...tags.map((tag) => `https://${HOST}/${tag}s/`),
	];

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
