// The full diary feed, one entry per logged watch. Lives in
// src/data/activity.json, keyed by username; see Activity data in AGENTS.md.

import rawActivity from "../data/activity.json";

export interface DiaryEntry {
	slug: string;
	title: string;
	year: number | null;
	tmdb: number | null;
	watchedDate: string | null;
	rating: number | null;
	rewatch: boolean;
	liked: boolean;
}

export interface ActivityData {
	generatedAt: string;
	people: Record<string, DiaryEntry[]>;
}

// The committed file stores a normalized form, not the flat entry above.
// Title, year and tmdb belong to the *film*, so they are held once in `films`
// rather than repeated on each of that film's watchers: with the entries also
// written one per line, the file is 63% smaller (1.63MB -> 0.61MB) and a new
// watch is a one-line diff instead of a ten-line one. It matters because the
// duplicated part grew with every logged watch, while `films` only grows when
// somebody watches a film nobody here had seen before.
export type StoredFilm = [
	title: string,
	year: number | null,
	tmdb: number | null,
];

export interface StoredEntry {
	s: string; // film slug, the join key
	d: string | null; // watched date
	r: number | null; // rating
	w?: 1; // rewatch, omitted when false
	l?: 1; // liked, omitted when false
}

export interface ActivityFile {
	generatedAt: string;
	films: Record<string, StoredFilm>;
	people: Record<string, StoredEntry[]>;
}

// Rehydrate the stored form into the flat entries the rest of the site reads.
// Everything downstream still sees a DiaryEntry, so the on-disk shape is this
// module's business alone.
export function loadActivity(file: ActivityFile): ActivityData {
	const people: Record<string, DiaryEntry[]> = {};
	for (const [username, entries] of Object.entries(file.people)) {
		people[username] = entries.map((e) => {
			const film = file.films[e.s];
			// A dangling slug would render a titleless row rather than fail, so
			// it is caught here instead of at the point of use.
			if (!film) {
				throw new Error(
					`activity.json: entry for "${username}" references an unknown film slug: ${e.s}`,
				);
			}
			const [title, year, tmdb] = film;
			return {
				slug: e.s,
				title,
				year,
				tmdb,
				watchedDate: e.d,
				rating: e.r,
				rewatch: e.w === 1,
				liked: e.l === 1,
			};
		});
	}
	return { generatedAt: file.generatedAt, people };
}

// Hydrated once for the whole build. Import this rather than the JSON: the
// film pages invert it per page, and re-hydrating at each of the eight call
// sites would repeat the same work for nothing.
export const activity: ActivityData = loadActivity(
	rawActivity as unknown as ActivityFile,
);

// The diary entry's page on Letterboxd. Derived rather than stored — the feed
// gives it, but ~6,400 copies of the same prefix is a lot of committed bytes.
export const filmEntryUrl = (username: string, slug: string) =>
	`https://letterboxd.com/${username}/film/${slug}/`;

// Every logged watch for one person, newest-watched first (undated entries last).
export const entriesFor = (
	activity: ActivityData,
	username: string,
): DiaryEntry[] => activity.people[username] ?? [];

// Every person in the directory has a page, including the dozen whose diary is
// empty — for them "yes, the account is real, and nothing is logged on it" is
// the answer to the query, so there is nothing to gate on. Build the path here
// rather than hardcoding it.
export const personPageUrl = (username: string) => `/people/${username}/`;

// "film" / "films". With a one-entry threshold the singular is reachable.
export const filmNoun = (n: number) => (n === 1 ? "film" : "films");

export interface DiaryStats {
	logged: number;
	rated: number;
	average: number | null;
}

// Feeds the page's summary line ("142 films logged, 96 rated, average 3.7★").
// The average is over rated entries only — about half of all entries carry no
// rating — and is null when none of them do.
export function diaryStats(entries: DiaryEntry[]): DiaryStats {
	const ratings = entries
		.map((e) => e.rating)
		.filter((r): r is number => r != null);
	return {
		logged: entries.length,
		rated: ratings.length,
		average: ratings.length
			? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
			: null,
	};
}

// A person page's meta description: the answer first, then the evidence.
// Search results truncate past ~155 characters, so a film title that won't fit
// is left out rather than the line running long — including the newest one,
// which is occasionally a title long enough to blow the budget on its own.
export function personDescription(
	name: string,
	username: string,
	entries: DiaryEntry[],
): string {
	if (entries.length === 0) {
		return `${name} has a public Letterboxd account (@${username}), but hasn't logged any films publicly yet. Updated daily.`;
	}
	const lead = `${name}'s public Letterboxd account (@${username}), with ${entries.length} ${filmNoun(entries.length)} logged.`;
	const line = (films: string[]) =>
		`${lead} Recently watched: ${films.join(", ")}. Updated daily.`;
	const titles: string[] = [];
	for (const entry of entries.slice(0, 3)) {
		if (line([...titles, entry.title]).length <= 158) titles.push(entry.title);
	}
	return titles.length > 0 ? line(titles) : `${lead} Updated daily.`;
}
