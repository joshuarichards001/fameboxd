// Helper for the `add-person` skill. Given a Letterboxd username it:
//   • fetches the most recent diary entry (lastWatched) from the RSS feed,
//   • fetches the follower count from the followers page, which doubles as the
//     liveness check (404 there means the handle is dead or mistyped),
//   • tries the public profile for identity signals (display name + the meta
//     description, which lists film counts, favorites, and bio) and the avatar
//     URL, and
//   • downloads an avatar and converts it to a 160×160 .webp (the site's
//     avatar convention).
//
// It writes NOTHING to people.json — the skill instructions handle that.
//
// Usage:
//   node fetch-person.mjs <username>                       # read-only report
//   node fetch-person.mjs <username> --avatar-out <path>   # also save avatar
//   node fetch-person.mjs <username> --avatar-out <path> --avatar-url <url>
//
// **The profile page is Cloudflare-blocked (403) to plain HTTP clients** — no
// user-agent or header combination gets through, and in a real browser it now
// serves a CAPTCHA rather than the page. The avatar no longer needs it: the
// followers page carries the owner's own avatar in its header (see
// avatarFromFollowersPage), so this runs unattended. Only the bio still lives
// solely on the profile. RSS and the followers page are unaffected.
//
// Prints a single JSON object on stdout. The lastWatched parsing mirrors
// scripts/fetch-activity.mjs, and the followers parsing scripts/
// fetch-followers.mjs (tiny parsers kept in sync by hand).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// First diary entry in the feed — mirrors scripts/fetch-activity.mjs.
function parseLastWatched(xml) {
	for (const [, item] of xml.matchAll(/<item>(.*?)<\/item>/gs)) {
		if (!/letterboxd-(?:watch|review)-/.test(item)) continue;
		const tag = (name) =>
			item.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
		const title = tag("letterboxd:filmTitle");
		if (!title) continue;
		const rating = tag("letterboxd:memberRating");
		return {
			title: decode(title),
			date: tag("letterboxd:watchedDate") ?? null,
			rating: rating ? Number(rating) : null,
		};
	}
	return null;
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

async function saveAvatar(url, outPath) {
	const buf = await get(url, true);
	const dir = mkdtempSync(join(tmpdir(), "lb-avatar-"));
	const src = join(dir, url.includes(".png") ? "src.png" : "src.jpg");
	writeFileSync(src, buf);
	try {
		execFileSync("cwebp", [
			"-quiet",
			"-resize",
			"160",
			"160",
			"-q",
			"82",
			src,
			"-o",
			outPath,
		]);
	} catch (err) {
		throw new Error(
			`cwebp failed (install with \`brew install webp\`): ${err.message}`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return outPath;
}

async function main() {
	const [, , username, ...rest] = process.argv;
	if (!username || username.startsWith("--")) {
		console.error("Usage: node fetch-person.mjs <username> [--avatar-out <path>]");
		process.exit(2);
	}
	const flag = (name) => {
		const i = rest.indexOf(name);
		return i !== -1 ? rest[i + 1] : null;
	};
	const avatarOut = flag("--avatar-out");
	// Explicit override; the followers page finds the avatar on its own now.
	const avatarUrlOverride = flag("--avatar-url");

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

	// RSS: most recent diary entry.
	try {
		const rss = await get(`https://letterboxd.com/${username}/rss/`);
		report.lastWatched = parseLastWatched(rss);
	} catch (err) {
		report.lastWatchedError = err.message;
	}

	console.log(JSON.stringify(report, null, 2));
}

await main();
