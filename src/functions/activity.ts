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
