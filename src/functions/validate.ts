import type { ActivityData, FilmsFile } from "./activity";
import type { Person } from "./people";
import { hasTagIntro } from "./tags";

const VOCAB = new Set([
	"actor",
	"director",
	"writer",
	"youtuber",
	"critic",
	"musician",
	"comedian",
	"podcaster",
	"developer",
	"producer",
]);

// Build-time data validation (fails the build on bad data).
export function validatePeople(people: Person[]): void {
	const seen = new Set<string>();
	const tagsInUse = new Set<string>();
	for (const p of people) {
		if (typeof p.name !== "string" || p.name.trim() === "") {
			throw new Error(`Entry missing a valid "name": ${JSON.stringify(p)}`);
		}
		if (typeof p.username !== "string" || !/^[a-z0-9_]+$/.test(p.username)) {
			throw new Error(`Entry "${p.name}" has an invalid username: ${p.username}`);
		}
		if (seen.has(p.username)) {
			throw new Error(`Duplicate username: ${p.username}`);
		}
		seen.add(p.username);
		if (typeof p.description !== "string" || p.description.trim() === "") {
			throw new Error(`Entry "${p.name}" is missing a description.`);
		}
		if (!Array.isArray(p.tags) || p.tags.length < 1 || p.tags.length > 3) {
			throw new Error(`Entry "${p.name}" must have 1–3 tags.`);
		}
		for (const tag of p.tags) {
			if (!VOCAB.has(tag)) {
				throw new Error(`Entry "${p.name}" has an out-of-vocabulary tag: ${tag}`);
			}
			tagsInUse.add(tag);
		}
		if (p.lastWatched != null) {
			const w = p.lastWatched;
			if (typeof w.title !== "string" || w.title.trim() === "") {
				throw new Error(`Entry "${p.name}" has a lastWatched without a title.`);
			}
			if (w.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) {
				throw new Error(`Entry "${p.name}" has an invalid lastWatched date: ${w.date}`);
			}
			if (w.rating != null && (typeof w.rating !== "number" || w.rating < 0.5 || w.rating > 5)) {
				throw new Error(`Entry "${p.name}" has an invalid lastWatched rating: ${w.rating}`);
			}
		}
		if (
			p.followers != null &&
			(!Number.isInteger(p.followers) || p.followers < 0)
		) {
			throw new Error(`Entry "${p.name}" has an invalid followers count: ${p.followers}`);
		}
	}
	for (const tag of tagsInUse) {
		if (!hasTagIntro(tag)) {
			throw new Error(
				`Tag "${tag}" is in use but has no intro in tags.ts.`,
			);
		}
	}
}

// A stored poster is a bare CDN path that the pages interpolate into an
// <img src>, and it is scraped off a third party, so its shape is checked
// rather than trusted: no scheme, host, query or traversal. The apostrophe is
// in the list because Letterboxd genuinely serves one ("marvin's%20room") and
// it threatens none of those things inside a double-quoted attribute; widening
// it further wants the same argument made again.
const POSTER_PATH = /^[A-Za-z0-9][A-Za-z0-9._%'/-]*$/;

// Build-time validation of src/data/films.json. Every film carries all four
// slots — a missing poster is null, never an absent element — because the
// whole point of the split from activity.json was that the presence of a
// field should not encode anything.
export function validateFilms(films: FilmsFile): void {
	for (const [slug, film] of Object.entries(films)) {
		if (!Array.isArray(film) || film.length !== 4) {
			throw new Error(
				`Film "${slug}" must be [title, year, tmdb, poster]: ${JSON.stringify(film)}`,
			);
		}
		const [title, year, tmdb, poster] = film;
		if (typeof title !== "string" || title.trim() === "") {
			throw new Error(`Film "${slug}" is missing a title.`);
		}
		if (year != null && !Number.isInteger(year)) {
			throw new Error(`Film "${slug}" has an invalid year: ${year}`);
		}
		if (tmdb != null && !Number.isInteger(tmdb)) {
			throw new Error(`Film "${slug}" has an invalid tmdb id: ${tmdb}`);
		}
		if (
			poster != null &&
			(typeof poster !== "string" ||
				!POSTER_PATH.test(poster) ||
				poster.includes("..") ||
				poster.includes("//"))
		) {
			throw new Error(`Film "${slug}" has an invalid poster path: ${poster}`);
		}
	}
}

// Build-time validation of src/data/activity.json against people.json.
export function validateActivity(activity: ActivityData, people: Person[]): void {
	const known = new Set(people.map((p) => p.username));
	for (const [username, entries] of Object.entries(activity.people)) {
		if (!known.has(username)) {
			throw new Error(`activity.json has entries for an unknown username: ${username}`);
		}
		for (const e of entries) {
			if (typeof e.slug !== "string" || !/^[a-z0-9-]+$/.test(e.slug)) {
				throw new Error(`Entry for "${username}" has an invalid film slug: ${e.slug}`);
			}
			if (typeof e.title !== "string" || e.title.trim() === "") {
				throw new Error(`Entry "${e.slug}" for "${username}" is missing a title.`);
			}
			if (e.watchedDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(e.watchedDate)) {
				throw new Error(
					`Entry "${e.slug}" for "${username}" has an invalid watchedDate: ${e.watchedDate}`,
				);
			}
			if (e.rating != null && (typeof e.rating !== "number" || e.rating < 0.5 || e.rating > 5)) {
				throw new Error(
					`Entry "${e.slug}" for "${username}" has an invalid rating: ${e.rating}`,
				);
			}
		}
	}
}
