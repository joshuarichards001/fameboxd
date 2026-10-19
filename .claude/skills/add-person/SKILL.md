---
name: add-person
description: Add a famous person to the Letterboxd directory from their name and Letterboxd username. Writes a house-style description and tags, fetches their most recent activity and follower count, downloads their avatar, and inserts the entry into src/data/people.json. Use when asked to "add <person>" with a letterboxd.com handle or username.
---

# Add a person to the directory

Given a **name** and a **Letterboxd username** (accept a full
`letterboxd.com/<username>/` URL too — the username is the last path segment),
add a complete, validated entry to `src/data/people.json`, seed their diary
file in `src/data/people/`, and drop their avatar into `public/avatars/`. If
either the name or username is missing, ask for it before starting.

The helper script `.claude/skills/add-person/fetch-person.mjs` does all the
mechanical fetching and file-writing — activity and the diary file, follower
count, and the avatar. You compose the description and pick the tags.

## Steps

### 1. Fetch everything

```
node .claude/skills/add-person/fetch-person.mjs <username> --avatar-out public/avatars/<username>.webp --seed-diary
```

This prints a JSON report — `accountLive`, `followers`, `lastWatched`,
`hasCustomAvatar` / `avatarSaved`, and `diary`. It needs no browser and no
network access beyond Letterboxd.

`--seed-diary` writes `src/data/people/<username>.json` from the RSS feed (the
build fails with `Missing diary file` without it) and adds any film it hasn't
seen to `src/data/films.json`, filling only empty slots. Both go through the
same parser and packers as the daily `fetch-activity` run, but touch only this
person.
The report's `diary` says how many entries landed and how many films were added
or gap-filled; a `diaryError` means nothing was written (rerun once the feed
answers). The feed holds only the ~50 most recently logged entries, and the
paginated diary pages that `backfill-diaries` reads currently answer 403, so
that window is the whole diary for now. If you abandon the person after this
step, delete their diary file too, or the build rejects it as an unknown
username.

Trust the user's word that the name and username belong to the same person —
that's the whole point of them giving you both. Don't cross-check the display
name or bio against the given name and don't stop to ask for confirmation just
because they differ (handles often don't match the name, or the account is
under a nickname/alias). The one thing worth a hard stop is `accountLive` being
`false` — that means the handle itself is dead or mistyped, which the user
couldn't have verified by eye any better than the fetch just did.

Expect `profileError: "403 …"` in the report. **The profile page is
Cloudflare-blocked to plain HTTP clients**, and in a real browser it now serves
a CAPTCHA — so the bio is simply unavailable, and the description in step 2 has
to come from what you know about the person. This is not a failure: followers,
activity and the avatar all come from unblocked pages.

The avatar is taken from the followers page, which carries the owner's own
photo in its header; the script upsizes it and converts it to the site's
96×96 `.webp`, using `sharp` (in `node_modules` via Astro) and falling back to
`cwebp` if it's missing. After it saves, view the file to confirm it's a real
photo of the right person, and check it against the avatar policy in
`AGENTS.md` (a clear headshot or a creator's recognizable logo — no unrelated
characters, childhood photos, or tiny/obscured faces). If it fails, replace it
with a suitable Wikimedia Commons image cropped to 96×96 WebP, or delete it to
fall back to the monogram.

`hasCustomAvatar: false` means they've set no photo (`avatarSourceUrl` absent,
or a Gravatar that 404s) — skip the avatar and the site renders a generated
initials monogram.

### 2. Compose the entry

Write, matching the existing entries in `src/data/people.json`:

- **description** — one concise sentence in the house style: what they're known
  for (notable works, role, or channel) in real life — not on Letterboxd. Look
  at neighbors for tone; keep it tight (see e.g. Dacre Montgomery, Rian Johnson,
  Nando v Movies). Describe why the person is notable — their career, notable
  work, or role — never their Letterboxd activity: no watch/film counts,
  favorites, ratings, "logged", or the word Letterboxd itself (the site is the
  Letterboxd directory; every entry implicitly has an account, so it doesn't
  need saying). If the handle differs from their name
  in a notable way, you may note it (see Lukas Gage) — that's about the handle,
  not their Letterboxd usage.
- **tags** — 1 to 3, drawn **only** from this fixed vocabulary (in
  `src/functions/validate.ts`): `actor`, `director`, `writer`, `youtuber`,
  `critic`, `musician`, `comedian`, `podcaster`, `developer`, `producer`.
  Anything outside it fails the build. So does a tag with no `INTROS` entry in
  `src/functions/tags.ts`, which is why `producer` is unusable as it stands —
  a genuinely new category needs both.
- **lastWatched** — copy the `lastWatched` object from the report verbatim
  (it's already in the right `{ title, date, rating } | null` shape).
- **followers** — copy the `followers` number from the report. It shows in the
  card's top-right corner and feeds the "Followers" sort.

### 3. Insert into people.json, alphabetically by name

Insert the object into the array keeping it **alphabetical by `name`** (compare
the full display name; `sortPeople` also enforces this at render, and validation
rejects duplicate usernames). Shape:

```json
{
  "name": "<Name>",
  "username": "<username>",
  "description": "<one sentence>",
  "tags": ["<tag>"],
  "lastWatched": { "title": "...", "date": "YYYY-MM-DD", "rating": 4.5 },
  "followers": 12345
}
```

### 4. Record the avatar in credits.html

Every kept avatar is credited in `public/avatars/credits.html`, keeping each
list alphabetical by name:

- **A replacement image** (e.g. from Wikimedia Commons) gets its own
  `<article id="<username>">` in the grid — copy a neighbor's shape: name,
  Wikipedia link, original image and file-details links, the photographer, and
  the license.
- **A kept Letterboxd avatar** gets a line in the "Retained profile images"
  list: `<li><a href="https://letterboxd.com/<username>/"><Name></a></li>`.

No avatar (monogram) means no entry.

### 5. Validate with a build

```
npm run build
```

The build runs `validatePeople`, so bad data fails it: enforce non-empty
name/description, `username` matching `^[a-z0-9_]+$` and unique, 1–3 in-vocab
tags, a well-formed `lastWatched`, and `followers` as a non-negative integer.
Fix any error it reports.

## Notes

- The script reuses `scripts/fetch-activity.mjs`'s parser for `lastWatched` and
  mirrors `scripts/fetch-followers.mjs` for `followers`; the daily refresh Action keeps
  both current after you add the person, so it's fine if the values are a
  little stale.
- The seeded diary is the feed's window, newest-first with undated entries
  last — the order `fetch-activity` keeps — and the daily Action merges new
  watches into it from then on. Don't run `npm run fetch-activity` or
  `npm run backfill-diaries` just to add one person: both touch everyone.
- New films arrive without a poster unless the feed carried one; the daily
  Action's `fetch-posters` step fills those in, and film pages fall back to a
  titled tile until then.
