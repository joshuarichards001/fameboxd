// Build-time view models for the film rankings dashboard. The public diary is
// reduced once per period; components receive bounded ranked lists and small
// aggregate series, never the source activity dataset.

import type { ActivityData, DiaryEntry } from "./activity";
import { FILM_PAGE_MIN_WATCHERS } from "./film-constants";

export const YEAR_MIN_ACTIVE_PEOPLE = 50;
export const YEAR_MIN_ENTRIES = 1_000;

export type FilmDashboardPeriod =
	| { kind: "all" }
	| { kind: "year"; year: number };

export interface ActivityBucket {
	key: string;
	label: string;
	entries: number;
	activePeople: number;
}

export interface RatingBucket {
	rating: number;
	count: number;
	percentage: number;
}

export interface DecadeBucket {
	decade: number;
	films: number;
}

export interface RankedFilm {
	slug: string;
	title: string;
	year: number | null;
	poster: string | null;
	entries: number;
	watchers: number;
	raters: number;
	average: number | null;
	weighted: number | null;
	rewatchers: number;
	rewatchEntries: number;
	newestWatch: string | null;
	standardDeviation: number | null;
}

export interface FilmDashboard {
	period: FilmDashboardPeriod;
	cutoff: string;
	entries: number;
	activePeople: number;
	distinctFilms: number;
	ratedCombinations: number;
	undatedEntries: number;
	periodRatingMean: number | null;
	weightedPrior: number;
	activity: ActivityBucket[];
	ratings: RatingBucket[];
	releaseDecades: DecadeBucket[];
	unknownReleaseYears: number;
	mostWatched: RankedFilm[];
	highestRated: RankedFilm[];
	mostRewatched: RankedFilm[];
	mostDivisive: RankedFilm[];
}

interface PersonFilm {
	entries: number;
	representativeRating: number | null;
	ratingDate: string;
	markedRewatch: boolean;
}

interface MutableFilm {
	slug: string;
	title: string;
	year: number | null;
	poster: string | null;
	people: Map<string, PersonFilm>;
	rewatchEntries: number;
	newestWatch: string;
}

const ALL_TIME: FilmDashboardPeriod = { kind: "all" };

const dataCutoff = (activity: ActivityData) => activity.generatedAt.slice(0, 10);

export const filmDashboardUrl = (period: FilmDashboardPeriod) =>
	period.kind === "all" ? "/rankings/" : `/rankings/year/${period.year}/`;

export function availableFilmPeriods(
	activity: ActivityData,
): FilmDashboardPeriod[] {
	const cutoff = dataCutoff(activity);
	const years = new Map<number, { entries: number; people: Set<string> }>();
	for (const [username, entries] of Object.entries(activity.people)) {
		for (const entry of entries) {
			if (!entry.watchedDate || entry.watchedDate > cutoff) continue;
			const year = Number(entry.watchedDate.slice(0, 4));
			const bucket = years.get(year) ?? { entries: 0, people: new Set() };
			bucket.entries++;
			bucket.people.add(username);
			years.set(year, bucket);
		}
	}
	return [
		ALL_TIME,
		...[...years]
			.filter(
				([, bucket]) =>
					bucket.entries >= YEAR_MIN_ENTRIES &&
					bucket.people.size >= YEAR_MIN_ACTIVE_PEOPLE,
			)
			.sort((a, b) => b[0] - a[0])
			.map(([year]) => ({ kind: "year" as const, year })),
	];
}

const populationDeviation = (values: number[], mean: number) =>
	Math.sqrt(
		values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
			values.length,
	);

const compareSlug = (a: RankedFilm, b: RankedFilm) =>
	a.slug.localeCompare(b.slug);

export function filmDashboard(
	activityData: ActivityData,
	period: FilmDashboardPeriod = ALL_TIME,
): FilmDashboard {
	const cutoff = dataCutoff(activityData);
	const year = period.kind === "year" ? period.year : null;
	const byFilm = new Map<string, MutableFilm>();
	const allTimeWatchers = new Map<string, Set<string>>();
	const activePeople = new Set<string>();
	const timeBuckets = new Map<
		string,
		{ entries: number; people: Set<string> }
	>();
	let entries = 0;
	let undatedEntries = 0;

	for (const [username, diary] of Object.entries(activityData.people)) {
		for (const entry of diary) {
			const date = entry.watchedDate;
			if (date && date > cutoff) continue;

			const allWatchers = allTimeWatchers.get(entry.slug) ?? new Set<string>();
			allWatchers.add(username);
			allTimeWatchers.set(entry.slug, allWatchers);

			if (year != null && (!date || Number(date.slice(0, 4)) !== year)) continue;
			entries++;
			activePeople.add(username);
			if (!date) undatedEntries++;

			let film = byFilm.get(entry.slug);
			if (!film) {
				film = {
					slug: entry.slug,
					title: entry.title,
					year: entry.year,
					poster: entry.poster,
					people: new Map(),
					rewatchEntries: 0,
					newestWatch: "",
				};
				byFilm.set(entry.slug, film);
			}
			if (date && date > film.newestWatch) film.newestWatch = date;
			if (entry.rewatch) film.rewatchEntries++;

			const person = film.people.get(username);
			if (person) {
				person.entries++;
				person.markedRewatch ||= entry.rewatch;
				const ratingDate = date ?? "";
				if (
					entry.rating != null &&
					(person.representativeRating == null || ratingDate > person.ratingDate)
				) {
					person.representativeRating = entry.rating;
					person.ratingDate = ratingDate;
				}
			} else {
				film.people.set(username, {
					entries: 1,
					representativeRating: entry.rating,
					ratingDate: entry.rating != null ? (date ?? "") : "",
					markedRewatch: entry.rewatch,
				});
			}

			if (date) {
				const key = year != null ? date.slice(0, 7) : date.slice(0, 4);
				const bucket = timeBuckets.get(key) ?? {
					entries: 0,
					people: new Set<string>(),
				};
				bucket.entries++;
				bucket.people.add(username);
				timeBuckets.set(key, bucket);
			}
		}
	}

	const ratingValues: number[] = [];
	const films: RankedFilm[] = [];
	for (const film of byFilm.values()) {
		const ratings = [...film.people.values()]
			.map((person) => person.representativeRating)
			.filter((rating): rating is number => rating != null);
		ratingValues.push(...ratings);
		const average = ratings.length
			? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
			: null;
		const watchers = film.people.size;
		films.push({
			slug: film.slug,
			title: film.title,
			year: film.year,
			poster: film.poster,
			entries: [...film.people.values()].reduce(
				(sum, person) => sum + person.entries,
				0,
			),
			watchers,
			raters: ratings.length,
			average,
			weighted: null,
			rewatchers: [...film.people.values()].filter(
				(person) => person.markedRewatch || person.entries > 1,
			).length,
			rewatchEntries: film.rewatchEntries,
			newestWatch: film.newestWatch || null,
			standardDeviation:
				average == null ? null : populationDeviation(ratings, average),
		});
	}

	const periodRatingMean = ratingValues.length
		? ratingValues.reduce((sum, rating) => sum + rating, 0) /
			ratingValues.length
		: null;
	const weightedPrior = year != null ? 5 : 10;
	if (periodRatingMean != null) {
		for (const film of films) {
			if (film.average == null) continue;
			film.weighted =
				(film.raters / (film.raters + weightedPrior)) * film.average +
				(weightedPrior / (film.raters + weightedPrior)) * periodRatingMean;
		}
	}

	const hasPage = (film: RankedFilm) =>
		(allTimeWatchers.get(film.slug)?.size ?? 0) >= FILM_PAGE_MIN_WATCHERS;
	const topFilms = (
		eligible: (film: RankedFilm) => boolean,
		compare: (a: RankedFilm, b: RankedFilm) => number,
	) => films.filter(eligible).sort(compare).slice(0, 10);
	const mostWatched = topFilms(
		(film) => film.watchers >= FILM_PAGE_MIN_WATCHERS,
		(a, b) =>
			b.watchers - a.watchers ||
			b.entries - a.entries ||
			(b.newestWatch ?? "").localeCompare(a.newestWatch ?? "") ||
			compareSlug(a, b),
	);
	const highestRated = topFilms(
		(film) => hasPage(film) && film.raters >= (year != null ? 5 : 10),
		(a, b) =>
			(b.weighted ?? -1) - (a.weighted ?? -1) ||
			b.raters - a.raters ||
			compareSlug(a, b),
	);
	const mostRewatched = topFilms(
		(film) => hasPage(film) && film.rewatchers >= 3,
		(a, b) =>
			b.rewatchers - a.rewatchers ||
			b.rewatchEntries - a.rewatchEntries ||
			b.watchers - a.watchers ||
			compareSlug(a, b),
	);
	const mostDivisive = topFilms(
		(film) => hasPage(film) && film.raters >= (year != null ? 10 : 20),
		(a, b) =>
			(b.standardDeviation ?? -1) - (a.standardDeviation ?? -1) ||
			b.raters - a.raters ||
			compareSlug(a, b),
	);

	const ratings = Array.from({ length: 10 }, (_, index) => {
		const rating = (index + 1) / 2;
		const count = ratingValues.filter((value) => value === rating).length;
		return {
			rating,
			count,
			percentage: ratingValues.length ? (count / ratingValues.length) * 100 : 0,
		};
	});
	const decades = new Map<number, number>();
	let unknownReleaseYears = 0;
	for (const film of films) {
		if (film.year == null) {
			unknownReleaseYears++;
			continue;
		}
		const decade = Math.floor(film.year / 10) * 10;
		decades.set(decade, (decades.get(decade) ?? 0) + 1);
	}

	let activity: ActivityBucket[];
	if (year != null) {
		const lastMonth =
			year === Number(cutoff.slice(0, 4)) ? Number(cutoff.slice(5, 7)) : 12;
		activity = Array.from({ length: lastMonth }, (_, index) => {
			const month = String(index + 1).padStart(2, "0");
			const key = `${year}-${month}`;
			const bucket = timeBuckets.get(key);
			return {
				key,
				label: new Intl.DateTimeFormat("en", {
					month: "short",
					timeZone: "UTC",
				}).format(new Date(`${key}-01T00:00:00Z`)),
				entries: bucket?.entries ?? 0,
				activePeople: bucket?.people.size ?? 0,
			};
		});
	} else {
		activity = [...timeBuckets]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([key, bucket]) => ({
				key,
				label: key,
				entries: bucket.entries,
				activePeople: bucket.people.size,
			}));
	}

	return {
		period,
		cutoff,
		entries,
		activePeople: activePeople.size,
		distinctFilms: films.length,
		ratedCombinations: ratingValues.length,
		undatedEntries,
		periodRatingMean,
		weightedPrior,
		activity,
		ratings,
		releaseDecades: [...decades]
			.sort((a, b) => a[0] - b[0])
			.map(([decade, count]) => ({ decade, films: count })),
		unknownReleaseYears,
		mostWatched,
		highestRated,
		mostRewatched,
		mostDivisive,
	};
}
