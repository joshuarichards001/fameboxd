// The cross-section: which of the celebrities in the directory logged a given
// film. Built by inverting activity.json on the film slug, which spec 01
// established as the join key between a person and a film; the film's own facts
// (title, year, tmdb, poster) ride in on the hydrated entries, from films.json.
// Pure over ActivityData — every username in it is a person in people.json
// (validateActivity enforces that) and every person has a page, so a watcher
// never needs gating beyond this.
//
// A film earns a page once FILM_PAGE_MIN_WATCHERS of them logged it. The
// cross-section is the whole point, and a handful of celebrities watching
// something is not one: at a threshold of 1 the site was 3,499 film pages of
// which 2,677 held a single row, drowning the few dozen that actually answer
// the query in near duplicates of each other. Below the threshold no page is
// built and nothing links to a film page, so no URL is ever published and
// later withdrawn — ask hasFilmPage before linking.

import { activity, type ActivityData, type DiaryEntry } from "./activity";

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
	// wherever it appears (0 conflicts across all 3,740 slugs), so any non-null
	// entry identifies it; a handful carry none and stay null.
	tmdb: number | null;
	// Letterboxd CDN path for the artwork, sized by posterUrl. Null only for a
	// film fetch-posters.mjs hasn't reached yet, so the page falls back rather
	// than assuming one is there.
	poster: string | null;
	watchers: FilmWatcher[];
	rated: number;
	average: number | null;
}

export const FILM_PAGE_MIN_WATCHERS = 10;

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
		// all slugs), so taking the newest entry's is a tie-break, not a merge.
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
			poster: newest.entry.poster,
			watchers,
			rated: ratings.length,
			average: ratings.length
				? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
				: null,
		});
	}
	return index;
}

// Every film in the data, most-watched first — including the ones with too few
// watchers to get a page, because person pages still list their titles.
export function rankedFilms(index: Map<string, Film>): Film[] {
	return [...index.values()].sort(
		(a, b) =>
			b.watchers.length - a.watchers.length || a.title.localeCompare(b.title),
	);
}

// Inverted once for the whole build. Every page that links a film consults it,
// and re-inverting 7,000 entries per person card is the one place where doing
// this lazily would show up in build time.
export const films: Map<string, Film> = filmIndex(activity);

// Does /films/<slug>/ exist? The only question worth asking before linking one.
export const hasFilmPage = (slug: string): boolean =>
	(films.get(slug)?.watchers.length ?? 0) >= FILM_PAGE_MIN_WATCHERS;

// The films that get a page, most-watched first — what /films/ lists and what
// /films/<slug>/ is generated from.
export function filmPages(index: Map<string, Film> = films): Film[] {
	return rankedFilms(index).filter(
		(f) => f.watchers.length >= FILM_PAGE_MIN_WATCHERS,
	);
}

// "celebrity" / "celebrities". Plural everywhere a film page uses it now that
// three watchers are the minimum, but the diary rows below the threshold still
// reach it with one.
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
