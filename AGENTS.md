# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A static site: a directory of celebrities (actors, directors,
musicians, creators) with verified public Letterboxd accounts. Each card shows
the person's most recent watch and links straight to their Letterboxd profile.
Built with Astro 7 (no UI framework runtime) and Tailwind CSS v4. Everything
renders at build time; the only client-side code is a small vanilla-JS tag
filter and sort.

## Commands

Dev server runs in background mode (project convention):

```
astro dev --background          # start; serves at localhost:4321
astro dev status | logs | stop  # manage the background server
```

- `npm run build` — production build to `dist/`. Runs `validatePeople` at build
  time, so **bad data fails the build** (see Data below).
- `npm run preview` — serve the built `dist/` locally.
- `npm run fetch-activity` — refresh each person's `lastWatched` in
  `src/data/people.json` from Letterboxd (see Activity data below). Never run
  by the build.
- `npm run fetch-followers` — refresh each person's `followers` in
  `src/data/people.json` (see Follower data below). Never run by the build.
- `npm run fetch-posters` — fill in the missing posters in
  `src/data/films.json` (see Film data below). Incremental; never run by the
  build.

## Architecture

The directory page lives in `src/components/DirectoryPage.astro` (via
`layouts/Base.astro` for the head boilerplate): it pulls in the data, runs
validation, and renders `Header`, `SearchControls`, `Directory` (the card
grid), and `Footer`. Two routes render it:

- `src/pages/index.astro` — the full directory at `/`.
- `src/pages/[tag].astro` — one SEO page per tag in use (`/directors/`,
  `/actors/`, …; slugs/labels from `src/functions/tags.ts`), pre-filtered
  server-side with a targeted `<title>`, h1 ("Directors on Letterboxd") and an
  intro (`tagIntro`, which also serves as the meta description — keep near 155
  chars). Every card on a tag page also appears on `/`, so that intro is the
  only text unique to the URL: keep each tag's hand-written and distinct, or
  Google reads the pages as duplicates of the homepage.

**Person pages** are `src/pages/people/[username].astro` — `/people/<username>/`,
one for **every** person in `people.json`, no threshold and no exceptions. The
dozen with an empty diary get an empty state instead of a table: "yes, the
account is real, and nothing is logged on it" is the answer their name is
searched with. Build the path with `personPageUrl(username)` from
`src/functions/activity.ts` rather than hardcoding it. `/people/` itself has no
index — the homepage already lists everyone.

**Film pages** are `src/pages/films/[slug].astro` — `/films/<slug>/`, one per
film that **`FILM_PAGE_MIN_WATCHERS` (10) or more** people logged; the other
~3,850 get no page, because a thin table restating a couple of diary lines is
already on those people's pages. `src/functions/films.ts` inverts `activity.json` into the
slug→watchers index everything else reads (`films`, the build's one inversion;
`filmPages` for the ones with a page; `filmPageUrl`). **Ask `hasFilmPage(slug)`
before linking a film** — below the threshold the title renders as plain text,
so no URL is ever published and later withdrawn. A watcher is a **person, not
an entry** — repeat logs collapse to that person's most recent one, and the
count in the `<h1>` must equal the rows in the table. The average is over the
watchers on the page and must never be presented as Letterboxd's own. The page
leads with the film's poster beside that header; it falls back to a titled tile
rather than assuming `film.poster` is set, since a film added today has no
poster until `fetch-posters` next runs. `/films/`
lists every page, which is why its per-row styling is hoisted onto the
`<table>` — repeating the classes on every row cost a megabyte of HTML back
when every film had one.

**`/recent/` and `/feed.xml`** (`src/pages/recent.astro`,
`src/pages/feed.xml.ts`) both render `recentWatches(activity, people, limit)`
from `src/functions/recent.ts` — the newest watches across everyone, which
drops undated entries and anything dated after today (`watchedDate` is
user-entered, and one typo'd future date would pin itself to the top for a
year). `/recent/` leads with a poster strip of the month's most-watched films
from `src/functions/trending.ts` — a **person, not an entry**, is a watcher, so
a rewatch never counts twice. Its thresholds are its own; `films.ts` answers
the all-time question and cannot answer this one. The feed is hand-rolled RSS 2.0: escape every interpolated value (film
titles contain `&`), and take no date from the build clock — `lastBuildDate`
comes off the newest item, so two builds on unchanged data are byte-identical.
Feed autodiscovery lives in `Base.astro`, so it is on every page.

**Structured data** is JSON-LD in `Base.astro`'s `@graph`: `WebSite` +
`Organization` on every page, plus a page's optional `schema` prop, whose nodes
come from `src/functions/schema.ts` (`directorySchema`, `personPageSchema`,
`filmPageSchema`). Every node carries an absolute `@id` off the page it lives
on, so one person is one entity across the directory, their own page and every
film they logged — extend those helpers rather than hand-writing nodes. Film
pages **must never emit `aggregateRating`**: our average is how a few of the
163 people here rated a film, not how the film is rated. Google's Rich Results
Test therefore calls `Movie` ineligible for want of an `image` (a poster) —
expected, and not a reason to add one.

A card is a **stretched link to the Letterboxd profile** — pressing a card
leaves the site, which is what a directory card is for. The person's name is
that `<a>`, its `after:inset-0` overlay covers the card, and the `@username`
handle is plain text because the card already goes there. The card's internal
exits — the diary link (`N films →`, to the person page) and the last-watched
film title — sit one layer above that overlay (z-index 1, `.card-out`); keep
them under the sticky filter bar's 5, or they scroll over the header. HTML
forbids nesting `<a>`, so anything else clickable inside a card has to join
that pattern, not wrap it.

**Data is the source of truth.** `src/data/people.json` is an array of
`{ name, username, description, tags, lastWatched }` (see the `Person`
interface in `src/functions/people.ts`); `lastWatched` is
`{ title, date, rating } | null`, maintained by the fetch script. Pure helpers
live in `src/functions/`:

- `people.ts` — `sortPeople` (alphabetical), `sortByRecentActivity` (default
  card order), `tagsByFrequency` (for the filter pills), `profileUrl`, and the
  display helpers `stars` and `timeAgo`.
- `validate.ts` — `validatePeople` enforces: non-empty name/description, unique
  usernames matching `^[a-z0-9_]+$`, 1–3 tags drawn from a **fixed `VOCAB`**
  (actor, director, writer, youtuber, critic, musician, comedian, podcaster,
  developer, producer), a well-formed `lastWatched` when
  present, and an intro for every tag in use. A new tag needs a `VOCAB` entry
  **and** an `INTROS` entry in `tags.ts`.
- `avatars.ts` — `loadAvatarSet()` reads `public/avatars/` at build time;
  **the filenames are the manifest** (no separate list). People with a matching
  `public/avatars/<username>.webp` get a photo; everyone else gets a
  deterministic initials monogram (`initials` + `hueFor`). No external requests.

**Activity data** is the `lastWatched` field on each entry in
`src/data/people.json` — the person's most recent diary entry (film title,
watched date, rating). It is **committed, not fetched at build time** —
`scripts/fetch-activity.mjs` refreshes it from the public RSS feed
`letterboxd.com/<username>/rss/` (one request per person; the script also
reformats `people.json` with `JSON.stringify`). A daily GitHub Action
(`.github/workflows/refresh-activity.yml`) reruns it and commits the diff. The
script degrades gracefully: per-person failures keep the previous (stale)
`lastWatched`, and it refuses to write only if every fetch fails.
`astro.config.mjs` also reads it to set each sitemap URL's `<lastmod>` (newest
watch date among that page's people) — keep it off build time, which would
mark every URL changed on every build. Once that Action commits, it runs
`scripts/submit-indexnow.mjs` (IndexNow — Bing and friends, not Google), which
derives the same URL set the sitemap lists from `people.json`. Ownership is
proved by `public/<key>.txt`, whose filename must match `KEY` in the script.

**The full diary** is `src/data/activity.json`, written by the same fetch
script from the same requests and committed alongside `people.json` (the Action
stages both). It is stored **normalized**: `{ generatedAt, people }`, where
`people` holds entries of `{s,d,r,w?,l?}` written **one per line**; the film
facts they point at live in `films.json` below. Never hand-edit or
`JSON.stringify` it — `packActivity` in the fetch script owns the format, and
both properties are load-bearing (a fraction of the flat form's size, and a new
watch is a one-line commit diff). Import the hydrated **`activity`** from
`src/functions/activity.ts`, never the JSON: `loadActivity` joins the two files
into the flat `DiaryEntry` everything downstream reads, once per build. The
Letterboxd film slug (`the-odyssey-2026`) is the join key between a person and
a film, and `validateActivity` gates the file at build time. The feed only
returns the ~50 most recently logged entries, so each run merges rather than
overwrites: fresh entries replace everything inside the feed's watched-date
range (so deletions propagate) and older entries are kept, capped at 200 per
person. Keys stay alphabetical and entries newest-first, or the daily commit
diff churns.

**Film data** is `src/data/films.json`: `slug -> [title, year, tmdb, poster]`,
one film per line, alphabetical, owned by `scripts/films-file.mjs` (both fetch
scripts import its packer — never write this file any other way). It is a
separate file from `activity.json` on purpose: these are facts about a film,
true whether or not anyone watched it lately, while `activity.json` is a log
that changes daily. **Every film carries all four slots**, `null` where
unknown — presence of a field must never encode anything, which is exactly the
bug the split fixed.

The `poster` is a Letterboxd CDN path with the size suffix stripped;
`posterUrl` rebuilds it at one of the two widths that CDN actually serves (most
sizes, 400x600 included, answer 403). It reaches the file two ways:
`fetch-activity` gets one free from the RSS entry description, but only while
that entry is inside the feed's ~50-entry window, so
`scripts/fetch-posters.mjs` fills the rest from each film's own page — its
JSON-LD `Movie` node carries the same URL. Film pages are served normally to a
plain client, unlike member profiles, and robots.txt allows them for a named
agent like ours. That script is incremental (it only fetches `null` posters,
checkpointing as it goes) and **never overwrites**, so `fetch-activity` must
keep gap-filling rather than rebuilding a film's row, or every daily run would
undo the backfill.

**Follower data** is the `followers` field on each entry — shown in the card's
top-right corner (`compactCount`, exact number in the `title`) and feeding the
"Followers" sort. Same shape as activity data: committed, not fetched at build
time; `scripts/fetch-followers.mjs` refreshes it in the same daily Action as
activity, on one commit; per-person failures keep the stale count. Both fetch
scripts identify themselves with a `fameboxd/1.0` UA rather than a browser
string — `/rss/` and `/followers/` are both allowed by Letterboxd's robots.txt.
The count is scraped from the sub-nav tooltip on
`letterboxd.com/<username>/followers/` — **the profile page itself is
Cloudflare-blocked (403)** to plain HTTP clients whatever headers you send, so
never scrape that; the followers page and RSS are unaffected. That page also
carries the owner's own avatar in its header, which is where the `add-person`
skill gets it — the profile's `og:image` is no longer needed, and a real
browser no longer helps (the profile serves a CAPTCHA). The bio is the one
thing now unreachable.

**Client-side filter/sort** is an inline `<script is:inline>` in
`Directory.astro`. Each `PersonCard` exposes `data-tags`, `data-name` and
`data-followers`;
the script filters cards by one active tag pill, and reorders them via the
sort chips (recently active — the default, keeping the server-rendered
`sortByRecentActivity` order — A–Z on `data-name`, and Followers on
`data-followers`).
Tag pills are real `<a>` links to the tag pages (crawlable); JS intercepts
clicks and mirrors the active tag into the URL path instead (`pushState`), and
restores state from the URL on load and `popstate`. Sort is deliberately not in
the URL. The filtered view must present itself as the tag page it mirrors, so
the pill carries `data-label` (h1) and `data-title` (document title, built by
`tagPageTitle`) — read them, never rebuild those strings in the script. No
framework, no build step for this logic.

**Styling** is Tailwind v4 configured via the Vite plugin (`astro.config.mjs`) —
there is no `tailwind.config`. Design tokens live in `@theme` in
`src/styles/global.css` (e.g. `--color-bg`, `--color-orange`, `--radius-card`),
which generate the utilities used in markup (`bg-bg`, `text-orange`,
`rounded-card`). Custom `@utility` blocks (`wrap`, `header-glow`) are defined
there too. It's a Letterboxd-inspired dark theme.

## Adding or editing a person

**Fast path:** the `add-person` skill (`.claude/skills/add-person/`) automates
this from a name + Letterboxd username — it writes a house-style description and
tags, fetches `lastWatched`, saves the avatar, and builds. Its helper
`fetch-person.mjs` also prints the profile's display name, bio, and activity on
its own. Do the steps below by hand when not using it:

1. Add an entry to `src/data/people.json` (keep it alphabetical by `name`;
   `sortPeople` also enforces order at render). Omit `lastWatched` — the fetch
   script fills it in on the next run.
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
- Never commit code without letting me verify the changes first.
