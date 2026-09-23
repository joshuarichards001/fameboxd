import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityData, DiaryEntry } from "./activity";
import {
	availableFilmPeriods,
	filmDashboard,
} from "./rankings";

const entry = (
	slug: string,
	date: string | null,
	rating: number | null,
	overrides: Partial<DiaryEntry> = {},
): DiaryEntry => ({
	slug,
	title: slug.toUpperCase(),
	year: 2020,
	tmdb: null,
	poster: null,
	watchedDate: date,
	rating,
	rewatch: false,
	liked: false,
	...overrides,
});

const fixture = (): ActivityData => {
	const people: ActivityData["people"] = {};
	for (let index = 0; index < 20; index++) {
		people[`person${index}`] = [
			entry("a", "2025-06-01", index === 0 ? 5 : index === 1 ? null : 4, {
				rewatch: index < 4,
			}),
			entry("b", "2025-05-01", 4),
			entry("c", "2025-04-01", index < 10 ? 0.5 : 5),
			entry("d", "2025-03-01", 3),
		];
		if (index < 3) {
			people[`person${index}`].push(
				entry("a", "2025-01-01", index === 0 ? 1 : 4),
			);
		}
		if (index < 10) people[`person${index}`].push(entry("u", null, null));
	}
	people.person0.unshift(entry("future", "2026-01-01", 5));
	return { generatedAt: "2025-06-30T10:00:00.000Z", people };
};

test("counts entries, watchers, ratings and rewatches per person-film", () => {
	const dashboard = filmDashboard(fixture());
	const film = dashboard.mostWatched.find((candidate) => candidate.slug === "a");
	assert.ok(film);
	assert.equal(film.entries, 23);
	assert.equal(film.watchers, 20);
	assert.equal(film.raters, 20);
	assert.equal(film.average, 4.05);
	assert.equal(film.rewatchers, 4);
	assert.equal(film.rewatchEntries, 4);
});

test("uses the newest non-null rating and excludes undated entries from year views", () => {
	const allTime = filmDashboard(fixture());
	const year = filmDashboard(fixture(), { kind: "year", year: 2025 });
	const film = year.mostWatched.find((candidate) => candidate.slug === "a");
	assert.equal(film?.average, 4.05);
	assert.equal(allTime.entries, 93);
	assert.equal(allTime.undatedEntries, 10);
	assert.equal(year.entries, 83);
	assert.equal(year.undatedEntries, 0);
	assert.equal(allTime.distinctFilms, 5);
	assert.equal(year.distinctFilms, 4);
});

test("calculates Bayesian ordering and population divisiveness", () => {
	const dashboard = filmDashboard(fixture());
	for (const film of dashboard.highestRated) {
		const expected =
			(film.raters / (film.raters + dashboard.weightedPrior)) *
				(film.average as number) +
			(dashboard.weightedPrior / (film.raters + dashboard.weightedPrior)) *
				(dashboard.periodRatingMean as number);
		assert.ok(Math.abs((film.weighted as number) - expected) < 1e-12);
	}
	assert.deepEqual(
		dashboard.highestRated.map((film) => film.slug),
		["a", "b", "d", "c"],
	);
	assert.equal(dashboard.mostDivisive[0]?.slug, "c");
	assert.equal(dashboard.mostDivisive[0]?.standardDeviation, 2.25);
	assert.equal(dashboard.mostDivisive.at(-1)?.slug, "d");
});

test("resolves ranking ties by slug", () => {
	const people: ActivityData["people"] = {};
	for (let index = 0; index < 10; index++) {
		people[`person${index}`] = [
			entry("tie-b", "2025-01-01", 3),
			entry("tie-a", "2025-01-01", 3),
		];
	}
	const dashboard = filmDashboard({
		generatedAt: "2025-06-30T10:00:00.000Z",
		people,
	});
	assert.deepEqual(
		dashboard.mostWatched.map((film) => film.slug),
		["tie-a", "tie-b"],
	);
});

test("limits every film ranking to its top ten", () => {
	const people: ActivityData["people"] = {};
	for (let person = 0; person < 20; person++) {
		people[`person${person}`] = [];
		for (let film = 0; film < 12; film++) {
			const slug = `film-${String(film).padStart(2, "0")}`;
			people[`person${person}`].push(
				entry(slug, "2025-06-01", person < 10 ? 0.5 : 5, {
					rewatch: true,
				}),
				entry(slug, "2025-05-01", null),
			);
		}
	}
	const dashboard = filmDashboard({
		generatedAt: "2025-06-30T10:00:00.000Z",
		people,
	});
	for (const ranking of [
		dashboard.mostWatched,
		dashboard.highestRated,
		dashboard.mostRewatched,
		dashboard.mostDivisive,
	]) {
		assert.equal(ranking.length, 10);
		assert.deepEqual(
			ranking.map((film) => film.slug),
			Array.from({ length: 10 }, (_, index) => `film-${String(index).padStart(2, "0")}`),
		);
	}
});

test("generates years only after both filtered thresholds are met", () => {
	const people: ActivityData["people"] = {};
	for (let person = 0; person < 50; person++) {
		people[`p${person}`] = [];
		for (let index = 0; index < 20; index++) {
			people[`p${person}`].push(
				entry(`film-${index}`, "2024-01-01", null),
			);
		}
		if (person < 49) {
			for (let index = 0; index < 21; index++) {
				people[`p${person}`].push(
					entry(`old-${index}`, "2023-01-01", null),
				);
			}
		}
		for (let index = 0; index < 20; index++) {
			people[`p${person}`].push(
				entry(`future-${index}`, "2026-01-01", null),
			);
		}
	}
	const periods = availableFilmPeriods({
		generatedAt: "2025-06-01T00:00:00.000Z",
		people,
	});
	assert.deepEqual(periods, [{ kind: "all" }, { kind: "year", year: 2024 }]);
});
