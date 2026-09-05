// The site's only subscribe channel: the same ordering /recent/ renders, as
// RSS 2.0. Hand-rolled rather than pulling in @astrojs/rss — it is thirty
// lines and the build stays dependency-free.

import type { APIRoute } from "astro";
import people from "../data/people.json";
import { activity, personPageUrl } from "../functions/activity";
import { filmPageUrl, filmTitle, hasFilmPage } from "../functions/films";
import { stars, type Person } from "../functions/people";
import { recentWatches, type RecentWatch } from "../functions/recent";

// Where an item points. A film over the page threshold has its own page —
// the cross-section is the interesting destination — and everything else goes
// to the person whose diary the watch came from, so no item links nowhere.
const itemLink = (watch: RecentWatch) =>
	hasFilmPage(watch.entry.slug)
		? filmPageUrl(watch.entry.slug)
		: personPageUrl(watch.person.username);

const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

// Escape everything interpolated. One unescaped "Deadpool & Wolverine" makes
// the whole document invalid XML, and readers drop an invalid feed silently.
const xml = (value: string) => value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

// "2026-08-20" -> "Thu, 20 Aug 2026 00:00:00 GMT". Dates are all the feed
// carries; Letterboxd diaries have no time of day.
const rfc822 = (date: string) => new Date(`${date}T00:00:00Z`).toUTCString();

const longDate = (date: string) =>
	new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});

const itemTitle = ({ person, entry }: RecentWatch) =>
	`${person.name} watched ${entry.title}${entry.rating != null ? ` ${stars(entry.rating)}` : ""}`;

// One plain sentence of facts. Never the review text — that stays on
// Letterboxd, and the link goes there through the film page.
const itemDescription = ({ person, entry }: RecentWatch) =>
	`${person.name} ${entry.rewatch ? "rewatched" : "watched"} ${filmTitle(entry)} on ${longDate(entry.watchedDate)}${
		entry.rating != null ? ` and rated it ${entry.rating}★` : ""
	}.`;

export const GET: APIRoute = ({ site }) => {
	const base = site ?? new URL("https://fameboxd.com/");
	const url = (path: string) => new URL(path, base).href;
	// Fewer items than /recent/: a reader that has been away for a week wants
	// the last few days, not a wall.
	const items = recentWatches(activity, people as Person[], 50);

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
	<channel>
		<title>${xml("Fameboxd — what celebrities are watching")}</title>
		<link>${xml(url("/"))}</link>
		<description>${xml(`The newest films logged by ${people.length} celebrities with public Letterboxd accounts. Updated daily.`)}</description>
		<language>en</language>
		<atom:link href="${xml(url("/feed.xml"))}" rel="self" type="application/rss+xml" />
		${
			// Derived from the newest watch, never from the build clock — a feed
			// whose dates move on every rebuild teaches readers to ignore them.
			items[0]
				? `<lastBuildDate>${rfc822(items[0].entry.watchedDate)}</lastBuildDate>`
				: ""
		}
${items
	.map(
		(watch) => `		<item>
			<title>${xml(itemTitle(watch))}</title>
			<link>${xml(url(itemLink(watch)))}</link>
			<description>${xml(itemDescription(watch))}</description>
			<pubDate>${rfc822(watch.entry.watchedDate)}</pubDate>
			<guid isPermaLink="false">${xml(`fameboxd:${watch.person.username}:${watch.entry.slug}:${watch.entry.watchedDate}`)}</guid>
		</item>`,
	)
	.join("\n")}
	</channel>
</rss>
`;

	return new Response(body, {
		headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
	});
};
