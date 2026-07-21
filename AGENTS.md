# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A single-page static site: a searchable directory of famous people (actors,
directors, musicians, creators) with verified public Letterboxd accounts. Built
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

## Architecture

The entire page is composed in `src/pages/index.astro`, which pulls in the data,
runs validation, and renders four components: `Header`, `SearchControls`,
`Directory` (the card grid), and `Footer`.

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

**Client-side search** is an inline `<script is:inline>` in `Directory.astro`.
Each `PersonCard` exposes `data-tags` and a lowercased `data-haystack`
(name + description + tags); the script filters cards by text query and one
active tag pill. No framework, no build step for this logic.

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
