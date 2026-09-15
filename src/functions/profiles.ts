// A person's complete diary reduced to the bounded view model rendered on
// their profile page. Taste is counted by unique film; viewing history is the
// one deliberately entry-based part of the model.

import {
	filmNoun,
	personDescription,
	type DiaryEntry,
} from "./activity";

export interface ProfileCohort {
	today: string;
}

export interface ProfileFilm {
	slug: string;
	title: string;
	year: number | null;
	poster: string | null;
	entries: number;
	representativeRating: number | null;
	liked: boolean;
	rewatched: boolean;
	// True when Letterboxd marks the sole visible entry as a rewatch. In that
	// case the earlier viewing is not in the public diary, so the UI must not
	// turn it into an invented count of two.
	rewatchCountKnown: boolean;
	newestWatch: string | null;
}

export interface RatingBucket {
	rating: number;
	count: number;
	percentage: number;
}

export interface DecadeBucket {
	decade: number;
	count: number;
}

export interface YearBucket {
	year: number;
	count: number;
}

export interface PersonProfile {
	diaryEntries: number;
	uniqueFilms: number;
	ratedFilms: number;
	averageRating: number | null;
	likedFilms: number;
	activeSince: string | null;
	ratingsGiven: RatingBucket[];
	releaseDecades: DecadeBucket[];
	unknownReleaseYears: number;
	mostLovedCandidates: number;
	lovedHighlights: ProfileFilm[];
	mostLoved: ProfileFilm[];
	viewingHistory: YearBucket[];
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export const profileCohort: ProfileCohort = { today: todayISO() };

interface MutableFilm extends ProfileFilm {
	markedRewatch: boolean;
}

const newest = (film: ProfileFilm) => film.newestWatch ?? "";
const rating = (film: ProfileFilm) => film.representativeRating ?? -1;

const completeSection = (films: ProfileFilm[], limit: number) =>
	films.length >= 3 ? films.slice(0, limit) : [];

export function profileFor(
	entries: DiaryEntry[],
	cohort: ProfileCohort,
): PersonProfile {
	const bySlug = new Map<string, MutableFilm>();
	const datedEntries: DiaryEntry[] = [];

	// Diary files are newest-first. The first non-null rating encountered is
	// therefore the representative rating; a newer unrated rewatch never wipes
	// out the older rating we find later.
	for (const entry of entries) {
		if (entry.watchedDate && entry.watchedDate <= cohort.today) {
			datedEntries.push(entry);
		}
		const current = bySlug.get(entry.slug);
		if (current) {
			current.entries++;
			current.liked ||= entry.liked;
			current.markedRewatch ||= entry.rewatch;
			if (current.representativeRating == null && entry.rating != null) {
				current.representativeRating = entry.rating;
			}
			if (
				entry.watchedDate &&
				entry.watchedDate <= cohort.today &&
				(entry.watchedDate > (current.newestWatch ?? ""))
			) {
				current.newestWatch = entry.watchedDate;
			}
			continue;
		}
		bySlug.set(entry.slug, {
			slug: entry.slug,
			title: entry.title,
			year: entry.year,
			poster: entry.poster,
			entries: 1,
			representativeRating: entry.rating,
			liked: entry.liked,
			rewatched: entry.rewatch,
			rewatchCountKnown: false,
			newestWatch:
				entry.watchedDate && entry.watchedDate <= cohort.today
					? entry.watchedDate
					: null,
			markedRewatch: entry.rewatch,
		});
	}

	const films = [...bySlug.values()].map((film): ProfileFilm => {
		const { markedRewatch, ...view } = film;
		return {
			...view,
			rewatched: film.entries >= 2 || markedRewatch,
			rewatchCountKnown: film.entries >= 2,
		};
	});
	const representativeRatings = films
		.map((film) => film.representativeRating)
		.filter((value): value is number => value != null);
	const averageRating = representativeRatings.length
		? representativeRatings.reduce((sum, value) => sum + value, 0) /
			representativeRatings.length
		: null;
	const dated = datedEntries
		.map((entry) => entry.watchedDate)
		.filter((date): date is string => date != null);
	const activeSince = dated.length
		? dated.reduce((a, b) => (a < b ? a : b))
		: null;
	const sparse = films.length < 5;

	const ratingsGiven: RatingBucket[] = [];
	if (!sparse && representativeRatings.length >= 5) {
		for (let rating = 0.5; rating <= 5; rating += 0.5) {
			const count = representativeRatings.filter(
				(value) => value === rating,
			).length;
			ratingsGiven.push({
				rating,
				count,
				percentage: (count / representativeRatings.length) * 100,
			});
		}
	}

	const knownYears = films.filter((film) => film.year != null);
	const releaseDecades: DecadeBucket[] = [];
	if (!sparse && knownYears.length >= 5) {
		const counts = new Map<number, number>();
		for (const film of knownYears) {
			const decade = Math.floor((film.year as number) / 10) * 10;
			counts.set(decade, (counts.get(decade) ?? 0) + 1);
		}
		for (const [decade, count] of [...counts].sort((a, b) => a[0] - b[0])) {
			releaseDecades.push({ decade, count });
		}
	}

	const lovedCandidates = films
		.filter(
			(film) =>
				film.liked ||
				(film.representativeRating ?? 0) >= 4.5 ||
				film.rewatched,
		)
		.sort(
			(a, b) =>
				Number(b.liked) - Number(a.liked) ||
				rating(b) - rating(a) ||
				b.entries - a.entries ||
				newest(b).localeCompare(newest(a)) ||
				a.slug.localeCompare(b.slug),
		);
	const mostLoved = sparse ? [] : completeSection(lovedCandidates, 6);

	const viewingHistory: YearBucket[] = [];
	if (!sparse && datedEntries.length > 0) {
		const counts = new Map<number, number>();
		for (const entry of datedEntries) {
			const year = Number(entry.watchedDate?.slice(0, 4));
			counts.set(year, (counts.get(year) ?? 0) + 1);
		}
		const years = [...counts.keys()];
		const first = Math.min(...years);
		const last = Math.max(...years);
		for (let year = first; year <= last; year++) {
			viewingHistory.push({ year, count: counts.get(year) ?? 0 });
		}
	}

	return {
		diaryEntries: entries.length,
		uniqueFilms: films.length,
		ratedFilms: representativeRatings.length,
		averageRating,
		likedFilms: films.filter((film) => film.liked).length,
		activeSince,
		ratingsGiven,
		releaseDecades,
		unknownReleaseYears: films.length - knownYears.length,
		mostLovedCandidates: lovedCandidates.length,
		lovedHighlights: lovedCandidates.slice(0, 2),
		mostLoved,
		viewingHistory,
	};
}

export function profileDescription(
	name: string,
	username: string,
	entries: DiaryEntry[],
	profile: PersonProfile,
): string {
	if (profile.uniqueFilms < 5) return personDescription(name, username, entries);
	const lead = `${name}'s Letterboxd diary: ${profile.uniqueFilms.toLocaleString("en")} unique ${filmNoun(profile.uniqueFilms)}, including ${profile.ratedFilms.toLocaleString("en")} rated ${filmNoun(profile.ratedFilms)}.`;
	const tail = " Updated daily.";
	const line = (titles: string[]) =>
		titles.length > 0
			? `${lead} Most loved: ${titles.join(", ")}.${tail}`
			: `${lead}${tail}`;
	const titles: string[] = [];
	for (const film of profile.lovedHighlights) {
		if (line([...titles, film.title]).length <= 158) titles.push(film.title);
	}
	return line(titles);
}
