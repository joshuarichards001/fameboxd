// The full diary feed, one entry per logged watch. Lives in
// src/data/activity.json, keyed by username; see Activity data in AGENTS.md.

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
