# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A static site: a searchable directory of famous people (actors, directors,
musicians, creators) with verified public Letterboxd accounts, plus a page per
person (`/<username>/`) showing their recent watches and favorite films. Built
with Astro 7 (no UI framework runtime) and Tailwind CSS v4. Everything renders
at build time; the only client-side code is a small vanilla-JS search filter.

## Commands

Dev server runs in background mode (project convention):

```
astro dev --background          # start; serves at localhost:4321
astro dev status | logs | stop  # manage the background server
```

- `npm run build` — production build to `dist/`. Runs `validatePeople` at build
  time, so **bad data fails the build** (see Data below).
- `npm run preview` — serve the built `dist/` locally.
- `npm run fetch-activity` — refresh `src/data/activity.json` from Letterboxd
  (see Activity data below). Never run by the build.

## Architecture

The directory page lives in `src/components/DirectoryPage.astro` (via
`layouts/Base.astro` for the head boilerplate): it pulls in the data, runs
validation, and renders `Header`, `SearchControls`, `Directory` (the card
grid), and `Footer`. Two routes render it:

- `src/pages/index.astro` — the full directory at `/`.
- `src/pages/[tag].astro` — one SEO page per tag in use (`/directors/`,
  `/actors/`, …; slugs/labels from `src/functions/tags.ts`), pre-filtered
  server-side with a targeted `<title>`, meta description, and h1
  ("Directors on Letterboxd"). Its `getStaticPaths` throws if a tag slug ever
  collides with a username (both route from the site root).

Each card links to `src/pages/[username].astro`, a statically generated
per-person page showing the 4 most recent watches and 4 favorite films
(`FilmPoster` tiles); its tag chips link back to the tag pages.

**Data is the source of truth.** `src/data/people.json` is an array of
`{ name, username, description, tags }` (see the `Person` interface in
`src/functions/people.ts`). Pure helpers live in `src/functions/`:

- `people.ts` — `sortPeople` (alphabetical), `tagsByFrequency` (for the filter
  pills), and `profileUrl`.
- `validate.ts` — `validatePeople` enforces: non-empty name/description, unique
  usernames matching `^[a-z0-9_]+$`, and 1–3 tags drawn from a **fixed `VOCAB`**
  (actor, director, writer, youtuber, critic, musician, comedian, podcaster,
  athlete). Adding a new tag means editing `VOCAB`.
- `avatars.ts` — `loadAvatarSet()` reads `public/avatars/` at build time;
  **the filenames are the manifest** (no separate list). People with a matching
  `public/avatars/<username>.webp` get a photo; everyone else gets a
  deterministic initials monogram (`initials` + `hueFor`). No external requests.

**Activity data** (`src/data/activity.json`) holds each person's 4 most recent
watches and 4 favorite films, keyed by username (types in
`src/functions/activity.ts`). It is **committed, not fetched at build time** —
`scripts/fetch-activity.mjs` regenerates it (recent watches from the public RSS
feed `letterboxd.com/<username>/rss/`; favorites scraped from the profile page,
with posters resolved from each film page's JSON-LD and cached by slug across
runs). A daily GitHub Action (`.github/workflows/refresh-activity.yml`) reruns
it and commits the diff. The script degrades gracefully: per-person failures
keep the previous (stale) data, and it refuses to write only if every fetch
fails. Poster images are hotlinked from Letterboxd's CDN (`a.ltrbxd.com`).

**Client-side search/filter/sort** is an inline `<script is:inline>` in
`Directory.astro`. Each `PersonCard` exposes `data-tags`, a lowercased
`data-haystack` (name + description + tags), and `data-watched` (last watched
date, for sorting); the script filters cards by text query and one active tag
pill, and reorders them via the sort chips (recently active — the default,
matching the server-rendered order via `sortByRecentActivity` — and A–Z).
Tag pills are real `<a>` links to the tag pages (crawlable); JS intercepts
clicks and mirrors state into the URL instead — the active tag as the path
(`pushState`), the search query as `?q=` (`replaceState`) — and restores state
from the URL on load and `popstate`. Sort is deliberately not in the URL. No
framework, no build step for this logic.

**Styling** is Tailwind v4 configured via the Vite plugin (`astro.config.mjs`) —
there is no `tailwind.config`. Design tokens live in `@theme` in
`src/styles/global.css` (e.g. `--color-bg`, `--color-orange`, `--radius-card`),
which generate the utilities used in markup (`bg-bg`, `text-orange`,
`rounded-card`). Custom `@utility` blocks (`wrap`, `header-glow`) are defined
there too. It's a Letterboxd-inspired dark theme.

## Adding or editing a person

1. Add an entry to `src/data/people.json` (keep it alphabetical by `name`;
   `sortPeople` also enforces order at render).
2. **Verify the Letterboxd handle is live before adding it** — load
   `https://letterboxd.com/<username>/`, confirm HTTP 200 and that the display
   name matches. Usernames get recycled, so a handle from a listicle may now
   belong to someone else.
3. Optionally drop a `public/avatars/<username>.webp` (square, matching the
   username exactly). Skip it to fall back to the generated monogram.
4. Run `npm run build` — validation will reject bad usernames, duplicates,
   missing descriptions, or out-of-vocab/miscounted tags.

## Notes

- `CLAUDE.md` is a symlink to `AGENTS.md` — edit `AGENTS.md`; both stay in sync.
- Requires Node >= 22.12. TypeScript uses Astro's `strict` tsconfig.
