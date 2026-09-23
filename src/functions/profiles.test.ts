import assert from "node:assert/strict";
import test from "node:test";
import type { DiaryEntry } from "./activity";
import { profileDescription, profileFor } from "./profiles";

const entry = (
	slug: string,
	rating: number | null,
	overrides: Partial<DiaryEntry> = {},
): DiaryEntry => ({
	slug,
	title: slug,
	year: 2020,
	tmdb: null,
	poster: null,
	watchedDate: "2025-01-01",
	rating,
	rewatch: false,
	liked: false,
	...overrides,
});

test("features only five-star films or films with at least two logged rewatches", () => {
	const entries = [
		entry("five-stars", 5),
		entry("four-and-half", 4.5),
		entry("liked-only", 2, { liked: true }),
		entry("marked-only", 1, { rewatch: true }),
		...Array.from({ length: 2 }, () => entry("two-watches", 1)),
		...Array.from({ length: 3 }, () => entry("three-watches", 1)),
		...Array.from({ length: 4 }, () => entry("four-watches", 1)),
	];
	const profile = profileFor(entries, { today: "2025-12-31" });

	assert.deepEqual(
		profile.standoutFilms.map((film) => film.slug),
		["five-stars", "four-watches", "three-watches"],
	);
	assert.match(
		profileDescription("Someone", "someone", entries, profile),
		/5★ ratings or 2\+ rewatches:/,
	);
});
