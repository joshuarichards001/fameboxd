// The cross-section: which of the celebrities in the directory logged a given
// film. Built by inverting activity.json on the film slug, which spec 01
// established as the join key between a person and a film. Pure over
// ActivityData — every username in it is a person in people.json
// (validateActivity enforces that) and every person has a page, so a watcher
// never needs gating beyond this.
//
// Every film in the data gets a page, down to the ~2,500 that exactly one
// person logged: there is no threshold and no predicate to ask, the same call
// the maintainer made for person pages.

import type { ActivityData, DiaryEntry } from "./activity";

export interface FilmWatcher {
	username: string;
	// That person's most recent entry for this film. Someone who logged it
	// three times is one watcher — counting entries would inflate the headline
	// number, which is the one thing on these pages worth quoting.
	entry: DiaryEntry;
}

export interface Film {
	slug: string;
	title: string;
	year: number | null;
	// TMDB's id for the film, for the structured data's sameAs. Consistent
	// wherever it appears (0 conflicts across 3,499 slugs), so any non-null
	// entry identifies it; 69 slugs carry none and stay null.
	tmdb: number | null;
	watchers: FilmWatcher[];
	rated: number;
	average: number | null;
}

export const filmPageUrl = (slug: string) => `/films/${slug}/`;

export const letterboxdFilmUrl = (slug: string) =>
	`https://letterboxd.com/film/${slug}/`;

// "The Odyssey (2026)". A handful of entries carry no year. Takes the title
// and year alone so a raw diary entry can be labelled the same way a film can.
export const filmTitle = (film: { title: string; year: number | null }) =>
	film.year != null ? `${film.title} (${film.year})` : film.title;

const watchedDate = (e: DiaryEntry) => e.watchedDate ?? "";

// Rating first (unrated last), then the most recent watch, then username so
// the row order is stable from build to build.
const compareWatchers = (a: FilmWatcher, b: FilmWatcher) =>
	(b.entry.rating ?? -1) - (a.entry.rating ?? -1) ||
	watchedDate(b.entry).localeCompare(watchedDate(a.entry)) ||
	a.username.localeCompare(b.username);

export function filmIndex(activity: ActivityData): Map<string, Film> {
	const byFilm = new Map<string, FilmWatcher[]>();
	for (const [username, entries] of Object.entries(activity.people)) {
		const seen = new Set<string>();
		for (const entry of entries) {
			// Entries are newest-watched first, so the first one wins the rewatch.
			if (seen.has(entry.slug)) continue;
			seen.add(entry.slug);
			const watchers = byFilm.get(entry.slug);
			if (watchers) watchers.push({ username, entry });
			else byFilm.set(entry.slug, [{ username, entry }]);
		}
	}

	const index = new Map<string, Film>();
	for (const [slug, watchers] of byFilm) {
		watchers.sort(compareWatchers);
		// Title and year are consistent across the dataset (0 conflicts across
		// 3,499 slugs), so taking the newest entry's is a tie-break, not a merge.
		const newest = watchers.reduce((a, b) =>
			watchedDate(b.entry) > watchedDate(a.entry) ? b : a,
		);
		const ratings = watchers
			.map((w) => w.entry.rating)
			.filter((r): r is number => r != null);
		index.set(slug, {
			slug,
			title: newest.entry.title,
			year: newest.entry.year,
			tmdb: watchers.map((w) => w.entry.tmdb).find((t) => t != null) ?? null,
			watchers,
			rated: ratings.length,
			average: ratings.length
				? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
				: null,
		});
	}
	return index;
}

// Every film, most-watched first — the order /films/ ranks them in, and the
// list every film page is generated from.
export function rankedFilms(index: Map<string, Film>): Film[] {
	return [...index.values()].sort(
		(a, b) =>
			b.watchers.length - a.watchers.length || a.title.localeCompare(b.title),
	);
}

// "celebrity" / "celebrities". Most films have exactly one watcher, so the
// singular is the common case, not an edge case.
export const celebrityNoun = (n: number) => (n === 1 ? "celebrity" : "celebrities");

// "Anne Hathaway, Ayo Edebiri and Barry Jenkins".
const listing = (names: string[]) =>
	names.length < 2
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// A film page's meta description: the count, some names, the average. Search
// results truncate past ~155 characters, so a name that won't fit is skipped
// and the shorter ones behind it still make the line.
export function filmDescription(film: Film, names: string[]): string {
	const n = film.watchers.length;
	const lead = `${n} ${celebrityNoun(n)} ${n === 1 ? "has" : "have"} logged ${film.title} on Letterboxd`;
	// An "average" of one rating is not an average, and most films here have
	// one watcher, so the rating sentence has to bend to the small numbers.
	const rating =
		film.average == null
			? `${n === 1 ? "They haven't" : "None of them"} rated it.`
			: film.rated === 1
				? `${n === 1 ? "They" : "One of them"} rated it ${film.average.toFixed(1)}★.`
				: `Average rating ${film.average.toFixed(1)}★ from ${film.rated} of them.`;
	const tail = ` ${rating} Updated daily.`;
	// "including" only when the names are a subset; naming all the watchers and
	// still saying "including" reads like there are more of them.
	const line = (chosen: string[]) =>
		chosen.length > 0
			? `${lead}${chosen.length === n ? ": " : ", including "}${listing(chosen)}.${tail}`
			: `${lead}.${tail}`;
	const chosen: string[] = [];
	for (const name of names.slice(0, 3)) {
		if (line([...chosen, name]).length <= 158) chosen.push(name);
	}
	return line(chosen);
}
