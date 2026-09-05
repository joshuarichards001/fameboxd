// src/data/films.json: every film anyone here has logged, keyed by the
// Letterboxd slug that joins a person to a film.
//
// It used to be the `films` map inside activity.json, which was a mistake: a
// film's title, year, tmdb id and poster are facts about the film, true
// whether or not anyone watched it lately, while activity.json is a log that
// changes every day. Worse, the poster was stored only for recently-watched
// films, so a field that looked like film metadata actually encoded "somebody
// watched this lately". Splitting the two puts each fact where its meaning is
// obvious, and every film now carries all four slots, poster included.
//
// Written one film per line and keyed alphabetically, for the same reason
// activity.json is: a new film has to be a one-line commit diff.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const FILMS_PATH = fileURLToPath(
	new URL("../src/data/films.json", import.meta.url),
);

// [title, year, tmdb, poster] — every slot always present, null when unknown.
// The poster is a Letterboxd CDN path with the size suffix stripped; posterUrl
// in src/functions/activity.ts rebuilds it at a size that CDN serves.
export const packFilms = (films) => {
	const j = JSON.stringify;
	const lines = Object.keys(films)
		.sort()
		.map((slug) => {
			const [title, year, tmdb, poster] = films[slug];
			return `  ${j(slug)}: ${j([title, year ?? null, tmdb ?? null, poster ?? null])}`;
		});
	return `{\n${lines.join(",\n")}\n}\n`;
};

// A CDN poster URL -> the base we store: everything before the size suffix,
// with the "?v=" cache-buster gone too. Letterboxd writes that suffix two ways
// ("-0-600-0-900-crop.jpg" and "-0-10-0-15-crop-resize600.jpg"), and both
// families of path appear — film-poster/... for artwork Letterboxd holds,
// sm/upload/... for one proxied from TMDB. posterUrl in
// src/functions/activity.ts puts a size back on.
//
// Defined here because both fetch scripts read a poster out of different
// documents (an RSS description, a film page's JSON-LD) that happen to carry
// the same URL: one regex, or they drift and one of them silently stores none.
export const posterBase = (url) =>
	url?.match(
		/a\.ltrbxd\.com\/resized\/([^"?\s]+?)-0-\d+-0-\d+-crop(?:-resize\d+)?\.(?:jpe?g|png)/,
	)?.[1] ?? null;

export async function readFilms() {
	const text = await readFile(FILMS_PATH, "utf8").catch(() => null);
	return text ? JSON.parse(text) : {};
}

// Returns whether anything changed, so a no-op run leaves the file — and the
// daily commit — untouched.
export async function writeFilms(films) {
	const next = packFilms(films);
	const before = await readFile(FILMS_PATH, "utf8").catch(() => null);
	if (next === before) return false;
	await writeFile(FILMS_PATH, next);
	return true;
}
