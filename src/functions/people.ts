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

// All tags in use, sorted by frequency then alphabetically, for the filter pills.
export function tagsByFrequency(people: Person[]): string[] {
	const tagCounts = new Map<string, number>();
	for (const p of people) {
		for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
	}
	return [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([t]) => t);
}

// 4.5 -> "★★★★½", matching Letterboxd's rating display.
export function stars(rating: number): string {
	return "★".repeat(Math.floor(rating)) + (rating % 1 ? "½" : "");
}

// "2026-07-19" -> "today" | "yesterday" | "2 days ago" | "3 weeks ago" | ...
// Computed at build time; the daily rebuild keeps it within a day of accurate.
export function timeAgo(iso: string): string {
	const days = Math.max(
		0,
		Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000),
	);
	const unit = (n: number, name: string) =>
		`${n} ${name}${n === 1 ? "" : "s"} ago`;
	if (days === 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 7) return unit(days, "day");
	if (days < 30) return unit(Math.round(days / 7), "week");
	if (days < 365) return unit(Math.round(days / 30), "month");
	return unit(Math.round(days / 365), "year");
}
