// Helper for the `add-person` skill. Given a Letterboxd username it:
//   • fetches the most recent diary entry (lastWatched) from the RSS feed,
//   • fetches the follower count from the followers page, which doubles as the
//     liveness check (404 there means the handle is dead or mistyped),
//   • tries the public profile for identity signals (display name + the meta
//     description, which lists film counts, favorites, and bio) and the avatar
//     URL, and
//   • downloads an avatar and converts it to a 96×96 .webp (the site's
//     avatar convention), and
//   • with --seed-diary, writes src/data/people/<username>.json from the RSS
//     feed and gap-fills src/data/films.json, since the build fails for a
//     person with no diary file.
//
// It writes NOTHING to people.json — the skill instructions handle that.
//
// Usage:
//   node fetch-person.mjs <username>                       # read-only report
//   node fetch-person.mjs <username> --avatar-out <path>   # also save avatar
//   node fetch-person.mjs <username> --avatar-out <path> --avatar-url <url>
//   node fetch-person.mjs <username> --seed-diary          # also seed diary
//
// **The profile page is Cloudflare-blocked (403) to plain HTTP clients** — no
// user-agent or header combination gets through, and in a real browser it now
// serves a CAPTCHA rather than the page. The avatar no longer needs it: the
// followers page carries the owner's own avatar in its header (see
// avatarFromFollowersPage), so this runs unattended. Only the bio still lives
// solely on the profile. RSS and the followers page are unaffected.
//
// Prints a single JSON object on stdout. The diary and lastWatched come from
// scripts/fetch-activity.mjs's own parser; the followers parsing mirrors
// scripts/fetch-followers.mjs (a tiny parser kept in sync by hand).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	mergeEntries,
	packEntries,
	parseDiary,
	unpackActivity,
} from "../../../scripts/fetch-activity.mjs";
import { readFilms, writeFilms } from "../../../scripts/films-file.mjs";
import { PEOPLE_DIR, writePerson } from "../../../scripts/people-files.mjs";

const UA = "fameboxd/1.0 (+https://fameboxd.com)";

const decode = (s) =>
	s
		.replace(/&#0?39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

async function get(url, asBuffer = false) {
	const res = await fetch(url, { headers: { "user-agent": UA } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return asBuffer ? Buffer.from(await res.arrayBuffer()) : res.text();
}

// Seeds the person's diary file from their RSS feed, the way the daily
// fetch-activity run would, but touching only this one person. The feed holds
// only the ~50 most recently logged entries, and the paginated diary that
// backfill-diaries reads currently answers 403, so that window is all a new
// person starts with. Rerunning merges into an existing file rather than
// replacing it, exactly as the daily run does.
//
// films.json is only gap-filled: a missing slug is added, and a null slot on a
// known film takes the feed's value, but nothing set is ever overwritten — a
// poster that fetch-posters backfilled must survive.
async function seedDiary(username, fresh) {
	const existing = await readFile(join(PEOPLE_DIR, `${username}.json`), "utf8")
		.then(JSON.parse)
		.catch((err) => {
			if (err.code === "ENOENT") return null;
			throw err;
		});
	const films = await readFilms();
	const previous = existing
		? unpackActivity({ [username]: existing }, films)[username]
		: [];
	const entries = mergeEntries(fresh, previous);
	await writePerson(username, new Date().toISOString(), packEntries(entries));

	let filmsAdded = 0;
	let filmsFilled = 0;
	for (const e of fresh) {
		const film = films[e.slug];
		if (!film) {
			films[e.slug] = [e.title, e.year, e.tmdb, e.poster];
			filmsAdded++;
			continue;
		}
		let filled = false;
		[e.year, e.tmdb, e.poster].forEach((value, i) => {
			if (film[i + 1] == null && value != null) {
				film[i + 1] = value;
				filled = true;
			}
		});
		if (filled) filmsFilled++;
	}
	await writeFilms(films);

	return {
		path: `src/data/people/${username}.json`,
		created: !existing,
		entries: entries.length,
		filmsAdded,
		filmsFilled,
	};
}

// Follower count from the followers page's sub-nav tooltip
// (`title="493,432&nbsp;people"`) — mirrors scripts/fetch-followers.mjs. The
// tooltip is omitted when nobody follows them.
function parseFollowers(html, username) {
	const link = html.match(
		new RegExp(`<a href="/${username}/followers/"([^>]*)>`),
	);
	if (!link) throw new Error("no followers link in page");
	const count = link[1].match(/title="([\d,]+)(?:&nbsp;|\s)/);
	return count ? Number(count[1].replace(/,/g, "")) : 0;
}

function textBetween(html, re) {
	const m = html.match(re);
	return m ? decode(m[1].replace(/<[^>]+>/g, "").trim()) : null;
}

function parseIdentity(html) {
	return {
		// The profile owner's display name (often just the username).
		displayName: textBetween(
			html,
			/person-display-name[^>]*>([\s\S]*?)<\/h1>/,
		),
		// e.g. "<user> uses Letterboxd... N films watched. Favorites: ... Bio: ..."
		metaDescription: textBetween(
			html,
			/<meta name="description" content="([^"]*)"/,
		),
	};
}

// The followers page header links the owner's own avatar, so it arrives on the
// same request as the follower count. Anchor the match on their own href:
// every other <img> on that page belongs to a member of the list (picking one
// of those was the bug fixed on 2026-07-22). The header serves it at 24px, but
// the size is just a path segment, so rewriting it asks the resizer for the
// same 1000px original og:image used to hand us — and the rewrite covers both
// uploaded avatars and Twitter-mirrored ones, whose paths differ. Gravatar and
// the static default are handled as they are below.
function avatarFromFollowersPage(html, username) {
	const src = html.match(
		new RegExp(
			`<a class="avatar[^"]*" href="/${username}/"[^>]*>\\s*<img src="([^"]+)"`,
		),
	)?.[1];
	if (!src) return null;
	const url = decode(src);
	if (url.includes("s.ltrbxd.com/static/")) return null;
	if (url.includes("gravatar.com/")) {
		return url
			.replace(/size=\d+/, "size=1000")
			.replace(/default=[^&]*/, "default=404");
	}
	return url.replace(/-0-\d+-0-\d+-crop/, "-0-1000-0-1000-crop");
}

// Fallback for the rare case the profile answers: og:image is the only avatar
// on that page guaranteed to be the owner's (inline <img> avatars can belong
// to other members). The static default on s.ltrbxd.com
// means no custom photo — resolve to null so the site renders its generated
// monogram. Gravatar og:images embed a default= fallback that would silently
// serve that same static png; swap it for 404 so a missing Gravatar fails the
// download instead of saving the placeholder.
function resolveAvatarUrl(html) {
	const url = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
	if (!url || url.includes("s.ltrbxd.com/static/")) return null;
	if (url.includes("gravatar.com/")) {
		return url.replace(/default=[^&]*/, "default=404");
	}
	return decode(url);
}

// The card renders these at 42px, so 96 covers a 2x screen with a little to
// spare. They were 160 until 2026-09-10, which was 51% more bytes for pixels
// no display could use.
const AVATAR_SIZE = 96;
const AVATAR_QUALITY = 85;

// sharp arrives with Astro, so it is in node_modules on any machine that can
// build the site; cwebp is the fallback for a checkout where it somehow isn't.
async function saveAvatar(url, outPath) {
	const buf = await get(url, true);
	const sharp = await import("sharp").then((m) => m.default, () => null);
	if (sharp) {
		await sharp(buf)
			.resize(AVATAR_SIZE, AVATAR_SIZE)
			.webp({ quality: AVATAR_QUALITY })
			.toFile(outPath);
		return outPath;
	}
	const dir = mkdtempSync(join(tmpdir(), "lb-avatar-"));
	const src = join(dir, url.includes(".png") ? "src.png" : "src.jpg");
	writeFileSync(src, buf);
	try {
		execFileSync("cwebp", [
			"-quiet",
			"-resize",
			String(AVATAR_SIZE),
			String(AVATAR_SIZE),
			"-q",
			String(AVATAR_QUALITY),
			src,
			"-o",
			outPath,
		]);
	} catch (err) {
		throw new Error(
			`sharp is unavailable and cwebp failed (run \`npm install\`, or \`brew install webp\`): ${err.message}`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return outPath;
}

async function main() {
	const [, , username, ...rest] = process.argv;
	if (!username || username.startsWith("--")) {
		console.error(
			"Usage: node fetch-person.mjs <username> [--avatar-out <path>] [--seed-diary]",
		);
		process.exit(2);
	}
	const flag = (name) => {
		const i = rest.indexOf(name);
		return i !== -1 ? rest[i + 1] : null;
	};
	const avatarOut = flag("--avatar-out");
	// Explicit override; the followers page finds the avatar on its own now.
	const avatarUrlOverride = flag("--avatar-url");
	const seed = rest.includes("--seed-diary");

	const report = { username };
	let avatarUrl = avatarUrlOverride;

	// Followers page: the count, the avatar, and the liveness check — it 404s
	// for a handle that doesn't exist, which the blocked profile can't tell us.
	try {
		const html = await get(`https://letterboxd.com/${username}/followers/`);
		report.accountLive = true;
		report.followers = parseFollowers(html, username);
		avatarUrl ??= avatarFromFollowersPage(html, username);
	} catch (err) {
		report.accountLive = !/^404 /.test(err.message);
		report.followersError = err.message;
	}

	// Profile: the bio, and the avatar if the followers page somehow had none.
	// Expected to 403 — the report says so plainly rather than looking like an
	// outage.
	try {
		const html = await get(`https://letterboxd.com/${username}/`);
		report.profileStatus = 200;
		Object.assign(report, parseIdentity(html));
		avatarUrl ??= resolveAvatarUrl(html);
	} catch (err) {
		report.profileError = err.message;
		if (/^403 /.test(err.message)) {
			report.profileNote =
				"Profile is Cloudflare-blocked to plain HTTP clients (expected); " +
				"the avatar came from the followers page. Only the bio is lost.";
		}
	}

	if (avatarUrl) report.avatarSourceUrl = avatarUrl;
	report.hasCustomAvatar = Boolean(avatarUrl);
	if (avatarOut && avatarUrl) {
		try {
			report.avatarSaved = await saveAvatar(avatarUrl, avatarOut);
		} catch (err) {
			// A Gravatar-backed profile whose Gravatar no longer exists 404s
			// (we ask for default=404 on purpose) — monogram it.
			if (!/^404 /.test(err.message)) throw err;
			report.avatarSaved = null;
			report.hasCustomAvatar = false;
			report.avatarNote =
				"No custom avatar; the site will render a monogram.";
		}
	}

	// RSS: the diary. Feed order, not watched-date order, for lastWatched —
	// the same "most recently logged" meaning fetch-activity gives it.
	let diary = null;
	try {
		const rss = await get(`https://letterboxd.com/${username}/rss/`);
		diary = parseDiary(rss);
		const latest = diary[0];
		report.lastWatched = latest
			? {
					title: latest.title,
					date: latest.watchedDate,
					rating: latest.rating,
				}
			: null;
	} catch (err) {
		report.lastWatchedError = err.message;
	}

	// Only for a live handle whose feed answered: a dead handle never becomes
	// a person, and a failed fetch is not an empty diary.
	if (seed) {
		if (!report.accountLive) {
			report.diaryError = "Account is not live; diary not seeded.";
		} else if (!diary) {
			report.diaryError = "RSS fetch failed; diary not seeded. Rerun with --seed-diary.";
		} else {
			report.diary = await seedDiary(username, diary);
		}
	}

	console.log(JSON.stringify(report, null, 2));
}

await main();
