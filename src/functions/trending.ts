// What the directory is watching *now*: the films several of these people
// logged in the last month. films.ts answers the all-time question and can't
// answer this one — a film with 40 watchers since 2019 is not what the strip
// at the top of /recent/ is for.
//
// A watcher is a **person, not an entry**, the same rule a film page counts
// by, so someone who logged a film three times in the window is one of them.

import type { ActivityData } from "./activity";

export const TRENDING_DAYS = 30;
// Five is what separates "the films everyone here saw this month" from the
// long tail: 21 films clear it today, and the top four are clear of the rest.
export const TRENDING_MIN_WATCHERS = 5;
export const TRENDING_LIMIT = 4;

export interface TrendingFilm {
	slug: string;
	title: string;
	year: number | null;
	poster: string | null;
	watchers: number;
	// Newest watch in the window. Only a tie-break, but films arrive here in
	// clumps around a release, so ties are the normal case rather than a rare one.
	newest: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const daysBefore = (today: string, days: number) =>
	new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000)
		.toISOString()
		.slice(0, 10);

export interface TrendingOptions {
	today?: string;
	days?: number;
	minWatchers?: number;
	limit?: number;
}

export function trendingFilms(
	activity: ActivityData,
	{
		today = todayISO(),
		days = TRENDING_DAYS,
		minWatchers = TRENDING_MIN_WATCHERS,
		limit = TRENDING_LIMIT,
	}: TrendingOptions = {},
): TrendingFilm[] {
	const since = daysBefore(today, days);
	const byFilm = new Map<string, TrendingFilm>();
	for (const entries of Object.values(activity.people)) {
		const counted = new Set<string>();
		for (const e of entries) {
			const date = e.watchedDate;
			// Undated entries can't be placed in a window at all, and dates are
			// user-entered: one typo'd 2027 would hold a film in the strip for a
			// month, which is the same guard recentWatches makes for the same reason.
			if (!date || date > today || date < since) continue;
			if (counted.has(e.slug)) continue;
			counted.add(e.slug);
			const film = byFilm.get(e.slug);
			if (film) {
				film.watchers++;
				if (date > film.newest) film.newest = date;
			} else {
				// Title, year and poster are the film's, held once in films.json and
				// handed to every entry by loadActivity, so the first entry's copy
				// is the film's — there is nothing to reconcile between them.
				byFilm.set(e.slug, {
					slug: e.slug,
					title: e.title,
					year: e.year,
					poster: e.poster,
					watchers: 1,
					newest: date,
				});
			}
		}
	}
	return [...byFilm.values()]
		.filter((f) => f.watchers >= minWatchers)
		.sort(
			(a, b) =>
				b.watchers - a.watchers ||
				b.newest.localeCompare(a.newest) ||
				a.slug.localeCompare(b.slug),
		)
		.slice(0, limit);
}
