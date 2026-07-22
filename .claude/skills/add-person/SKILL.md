---
name: add-person
description: Add a famous person to the Letterboxd directory from their name and Letterboxd username. Writes a house-style description and tags, fetches their most recent activity, downloads their avatar, and inserts the entry into src/data/people.json. Use when asked to "add <person>" with a letterboxd.com handle or username.
---

# Add a person to the directory

Given a **name** and a **Letterboxd username** (accept a full
`letterboxd.com/<username>/` URL too — the username is the last path segment),
add a complete, validated entry to `src/data/people.json` and drop their avatar
into `public/avatars/`. If either the name or username is missing, ask for it
before starting.

The helper script `.claude/skills/add-person/fetch-person.mjs` does the
mechanical fetching (activity + avatar, plus the profile's display name and bio
as context for the description). You compose the description and pick the tags.

## Steps

### 1. Fetch activity + avatar

```
node .claude/skills/add-person/fetch-person.mjs <username> --avatar-out public/avatars/<username>.webp
```

This prints a JSON report — `profileStatus`, `displayName`, `metaDescription`
(film count, favorites, bio), and `lastWatched` — and saves the avatar. If the
account has **no custom avatar** the report says so and saves nothing; that's
fine, the site renders a generated initials monogram. Avatar conversion needs
`cwebp` (`brew install webp`). After it saves, view the file to confirm it's the
right photo.

Trust the user's word that the name and username belong to the same person —
that's the whole point of them giving you both. Don't cross-check `displayName`
or the bio against the given name and don't stop to ask for confirmation just
because they differ (handles often don't match the name, or the account is
under a nickname/alias). The one thing worth a hard stop is `profileStatus` not
being 200 — that means the handle itself is dead or mistyped, which the user
couldn't have verified by eye any better than the fetch just did.

### 2. Compose the entry

Write, matching the existing entries in `src/data/people.json`:

- **description** — one concise sentence in the house style: what they're known
  for (notable works, role, or channel) in real life — not on Letterboxd. Look
  at neighbors for tone; keep it tight (see e.g. Dacre Montgomery, Rian Johnson,
  Nando v Movies). Describe why the person is notable — their career, notable
  work, or role — never their Letterboxd activity: no watch/film counts,
  favorites, ratings, "logged", or the word Letterboxd itself (the site is the
  Letterboxd directory; every entry implicitly has an account, so it doesn't
  need saying). The report's `metaDescription` bio is useful raw material for
  who they are, but don't lift its Letterboxd-specific details (film counts,
  favorites lists) into the description. If the handle differs from their name
  in a notable way, you may note it (see Lukas Gage) — that's about the handle,
  not their Letterboxd usage.
- **tags** — 1 to 3, drawn **only** from this fixed vocabulary (in
  `src/functions/validate.ts`): `actor`, `director`, `writer`, `youtuber`,
  `critic`, `musician`, `comedian`, `podcaster`, `athlete`, `developer`.
  Anything outside it fails the build; adding a genuinely new category means
  editing `VOCAB` first.
- **lastWatched** — copy the `lastWatched` object from the report verbatim
  (it's already in the right `{ title, date, rating } | null` shape).

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
  "lastWatched": { "title": "...", "date": "YYYY-MM-DD", "rating": 4.5 }
}
```

### 4. Validate with a build

```
npm run build
```

The build runs `validatePeople`, so bad data fails it: enforce non-empty
name/description, `username` matching `^[a-z0-9_]+$` and unique, 1–3 in-vocab
tags, and a well-formed `lastWatched`. Fix any error it reports.

## Notes

- The script mirrors `scripts/fetch-activity.mjs` for `lastWatched`; the daily
  refresh Action keeps that field current after you add the person, so it's fine
  if the value is a day stale.
