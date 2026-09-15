// One-time, resumable import of every public, dated diary row. The daily RSS
// refresh remains responsible for new entries (including undated reviews).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFilms, writeFilms } from "./films-file.mjs";
import { readPeopleFiles, writePerson } from "./people-files.mjs";
import { unpackActivity, packEntries } from "./fetch-activity.mjs";

const people = JSON.parse(await readFile(new URL("../src/data/people.json", import.meta.url), "utf8"));
const checkpoint = join(tmpdir(), "fameboxd-diary-backfill");
await mkdir(checkpoint, { recursive: true });
const films = await readFilms();
const previous = unpackActivity(await readPeopleFiles(), films);
const decode = (s) => s.replace(/&(?:amp|quot|lt|gt|#39|#x27);|&#(\d+);/g, (match, n) =>
	n ? String.fromCodePoint(Number(n)) : ({ "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&#39;": "'", "&#x27;": "'" })[match]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(username, page) {
	const path = join(checkpoint, `${username}-${page}.html`);
	const cached = await readFile(path, "utf8").catch(() => null);
	if (cached) return cached;
	const url = page === 1
		? `https://letterboxd.com/${username}/diary/`
		: `https://letterboxd.com/${username}/diary/films/page/${page}/`;
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const res = await fetch(url, { headers: { "user-agent": "fameboxd/1.0 (+https://fameboxd.com)" }, signal: AbortSignal.timeout(30000) });
			if (!res.ok) throw new Error(`${res.status} ${url}`);
			const html = await res.text();
			if (!html.includes("diary-entry-row") && !html.includes("diary-table")) {
				// A genuinely empty diary is allowed; a challenge page is not.
				if (!/No\s+diary entries yet/i.test(html)) throw new Error(`Unexpected diary markup: ${url}`);
			}
			await writeFile(path, html);
			await delay(250);
			return html;
		} catch (err) {
			if (attempt === 3) throw err;
			await delay(1500 * 2 ** attempt);
		}
	}
}

function parsePage(html, username) {
	const rows = [...html.matchAll(/<tr class="diary-entry-row\b[\s\S]*?<\/tr>/g)];
	const entries = rows.map(([row]) => {
		const field = (re) => row.match(re)?.[1];
		const slug = field(/data-item-slug="([^"]+)"/);
		const title = field(/<h2 class="primaryname[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/);
		const date = field(new RegExp(`/${username}/diary/films/for/(\\d{4}/\\d{2}/\\d{2})/`));
		const year = field(/<td class="col-releaseyear[^>]*><span>(\d{4})<\/span>/);
		const rating = field(/<span class="rating rated-(\d+)"/);
		const rewatchCell = field(/<td class="([^"]*\bcol-rewatch\b[^"]*)"/);
		if (!slug || !title || !date || !rewatchCell) throw new Error(`Unrecognized diary row for ${username}: ${row.slice(0, 200)}`);
		return {
			slug, title: decode(title.replace(/<[^>]*>/g, "")), year: year ? Number(year) : null,
			tmdb: null, poster: null, watchedDate: date.replaceAll("/", "-"),
			rating: rating ? Number(rating) / 2 : null,
			rewatch: !rewatchCell.includes("icon-status-off"),
			liked: /class="[^"]*\bicon-liked\b[^"]*\bhide-for-owner\b/.test(row),
		};
	});
	const pages = [...html.matchAll(/\/diary\/films\/page\/(\d+)\//g)].map((m) => Number(m[1]));
	return { entries, totalPages: Math.max(1, ...pages) };
}

let completed = 0;
let failed = 0;
let partial = 0;
for (const person of people) {
	const username = person.username;
	try {
		const firstHtml = await fetchPage(username, 1);
		const expected = firstHtml.match(/section-heading"><span class="tooltip" title="([\d,]+)&nbsp;films?">Diary/);
		if (!expected) throw new Error("Could not read the public diary count");
		const expectedCount = Number(expected[1].replaceAll(",", ""));
		const first = parsePage(firstHtml, username);
		const entries = [...first.entries];
		for (let page = 2; page <= first.totalPages; page++) {
			const result = parsePage(await fetchPage(username, page), username);
			if (!result.entries.length) throw new Error(`Page ${page} was unexpectedly empty`);
			entries.push(...result.entries);
		}
		if (entries.length !== expectedCount) {
			if (expectedCount - entries.length !== 1) throw new Error(`Expected ${expectedCount} diary rows, parsed ${entries.length}`);
			// Letterboxd's header may count a viewing excluded from its public
			// rows. Preserve every visible row and report the discrepancy.
			partial++;
			console.warn(`PARTIAL ${username}: header says ${expectedCount}, public pages contain ${entries.length}`);
		}
		// Rows may repeat the same film/date; each row is a distinct viewing.
		// Retain reviews without diary dates, which are only in the RSS feed.
		const undated = (previous[username] ?? []).filter((e) => !e.watchedDate);
		const merged = [...entries, ...undated];
		for (const entry of entries) {
			const old = films[entry.slug];
			films[entry.slug] = [old?.[0] ?? entry.title, old?.[1] ?? entry.year, old?.[2] ?? null, old?.[3] ?? null];
		}
		await writeFilms(films);
		await writePerson(username, new Date().toISOString(), packEntries(merged));
		completed++;
		console.log(`ok ${username}: ${entries.length} diary rows, ${first.totalPages} pages`);
	} catch (err) {
		failed++;
		console.warn(`FAIL ${username}: ${err.message}`);
	}
}
console.log(`Complete: ${completed}/${people.length} people; ${partial} count discrepancies, ${failed} failed. Checkpoints: ${checkpoint}`);
if (failed) process.exitCode = 1;
