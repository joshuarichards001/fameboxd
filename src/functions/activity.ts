import type { Person } from "./people";

export interface FavoriteFilm {
	title: string;
	slug: string;
	url: string;
	poster: string | null;
}

export interface RecentFilm {
	title: string;
	year: string | null;
	rating: number | null;
	watchedDate: string | null;
	url: string | null;
	poster: string | null;
}

export interface PersonActivity {
	recent: RecentFilm[];
	favorites: FavoriteFilm[];
}

export interface ActivityData {
	generatedAt: string;
	people: Record<string, PersonActivity>;
}

// Most recently active first (by last logged watch date), A–Z tie-break;
// people with no dated activity sink to the end.
export function sortByRecentActivity(
	people: Person[],
	activity: ActivityData["people"],
): Person[] {
	const last = (u: string) => activity[u]?.recent[0]?.watchedDate ?? "";
	return [...people].sort(
		(a, b) =>
			last(b.username).localeCompare(last(a.username)) ||
			a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
	);
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

// "2026-07-19" -> "Jul 19" (or "Jul 19, 2025" for past years).
export function formatWatchedDate(iso: string): string {
	const date = new Date(`${iso}T00:00:00Z`);
	const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
	if (date.getUTCFullYear() !== new Date().getUTCFullYear()) opts.year = "numeric";
	return date.toLocaleDateString("en-US", opts);
}
