---
name: add-person
description: Add a famous person to the Letterboxd directory from their name and Letterboxd username. Writes a house-style description and tags, fetches their most recent activity and follower count, downloads their avatar, and inserts the entry into src/data/people.json. Use when asked to "add <person>" with a letterboxd.com handle or username.
---

# Add a person to the directory

Given a **name** and a **Letterboxd username** (accept a full
`letterboxd.com/<username>/` URL too — the username is the last path segment),
add a complete, validated entry to `src/data/people.json` and drop their avatar
into `public/avatars/`. If either the name or username is missing, ask for it
before starting.

The helper script `.claude/skills/add-person/fetch-person.mjs` does all the
mechanical fetching — activity, follower count, and the avatar. You compose the
description and pick the tags.

## Steps

### 1. Fetch everything

```
node .claude/skills/add-person/fetch-person.mjs <username> --avatar-out public/avatars/<username>.webp
```

This prints a JSON report — `accountLive`, `followers`, `lastWatched`, and
`hasCustomAvatar` / `avatarSaved`. It needs no browser and no network access
beyond Letterboxd.

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
160×160 `.webp`. Conversion needs `cwebp` (`brew install webp`). After it saves,
view the file to confirm it's a real photo of the right person.

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

### 4. Validate with a build

```
npm run build
```

The build runs `validatePeople`, so bad data fails it: enforce non-empty
name/description, `username` matching `^[a-z0-9_]+$` and unique, 1–3 in-vocab
tags, a well-formed `lastWatched`, and `followers` as a non-negative integer.
Fix any error it reports.

## Notes

- The script mirrors `scripts/fetch-activity.mjs` for `lastWatched` and
  `scripts/fetch-followers.mjs` for `followers`; the daily refresh Action keeps
  both current after you add the person, so it's fine if the values are a
  little stale.
- It does not touch `src/data/activity.json`, so until the daily Action runs,
  the new person's `/people/<username>/` page shows the empty-diary state even
  though they have one. Run `npm run fetch-activity` if the site is being
  deployed before then — it refreshes everyone, so expect a wide diff.
