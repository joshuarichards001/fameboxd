export interface LastWatched {
	title: string;
	date: string | null;
	rating: number | null;
}

export interface Person {
	name: string;
	username: string;
	description: string;
	tags: string[];
	lastWatched?: LastWatched | null;
	followers?: number | null;
}

export const profileUrl = (username: string) =>
	`https://letterboxd.com/${username}/`;

// Alphabetical by name (data file is already sorted, but enforce it here).
export function sortPeople(people: Person[]): Person[] {
	return [...people].sort((a, b) =>
		a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
	);
}

// Most recently active first (by last logged watch date), A–Z tie-break;
// people with no dated activity sink to the end.
export function sortByRecentActivity(people: Person[]): Person[] {
	const last = (p: Person) => p.lastWatched?.date ?? "";
	return [...people].sort(
		(a, b) =>
			last(b).localeCompare(last(a)) ||
			a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
	);
}

// How many people carry each tag in use.
export function tagCounts(people: Person[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const p of people) {
		for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
	}
	return counts;
}

// All tags in use, sorted by frequency then alphabetically, for the filter pills.
export function tagsByFrequency(people: Person[]): string[] {
	return [...tagCounts(people).entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([t]) => t);
}

// 4.5 -> "★★★★½", matching Letterboxd's rating display.
export function stars(rating: number): string {
	return "★".repeat(Math.floor(rating)) + (rating % 1 ? "½" : "");
}

// 493432 -> "493K", 9767 -> "9.8K", 20 -> "20". Abbreviated so a six-figure
// count still fits the card's top-right corner; the card's title attribute
// carries the exact number.
export function compactCount(n: number): string {
	if (n < 1000) return String(n);
	const trim = (s: string) => s.replace(/\.0$/, "");
	if (n < 10_000) return `${trim((n / 1000).toFixed(1))}K`;
	// Round first, so 999,999 reads "1M" rather than "1000K".
	const k = Math.round(n / 1000);
	if (k < 1000) return `${k}K`;
	return `${trim((n / 1_000_000).toFixed(1))}M`;
}

// Whole days between a watched date and the build. Shared by both formatters.
function daysSince(iso: string): number {
	return Math.max(
		0,
		Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000),
	);
}

// "2026-07-19" -> "today" | "yesterday" | "2 days ago" | "3 weeks ago" | ...
// Computed at build time; the daily rebuild keeps it within a day of accurate.
export function timeAgo(iso: string): string {
	const days = daysSince(iso);
	const unit = (n: number, name: string) =>
		`${n} ${name}${n === 1 ? "" : "s"} ago`;
	if (days === 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 7) return unit(days, "day");
	if (days < 30) return unit(Math.round(days / 7), "week");
	if (days < 365) return unit(Math.round(days / 30), "month");
	return unit(Math.round(days / 365), "year");
}

// The same thing in a table cell's worth of characters: "3d ago", "2w ago",
// "5m ago", "2y ago". The cell's <time> keeps the exact date in its title, so
// nothing is lost by abbreviating — and the column stays narrow enough that a
// phone doesn't have to scroll the table sideways to reach it.
export function timeAgoShort(iso: string): string {
	const days = daysSince(iso);
	if (days === 0) return "today";
	if (days < 7) return `${days}d ago`;
	if (days < 30) return `${Math.round(days / 7)}w ago`;
	if (days < 365) return `${Math.round(days / 30)}m ago`;
	return `${Math.round(days / 365)}y ago`;
}
