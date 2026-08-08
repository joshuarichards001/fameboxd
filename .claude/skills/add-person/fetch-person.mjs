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
// user-agent or header combination gets through, and no other profile subpage
// carries the owner's avatar or bio. So identity signals and the avatar URL
// have to come from a real browser; the skill instructions cover that, and
// `--avatar-url` feeds the og:image found there back into the conversion
// pipeline below. RSS and the followers page are unaffected.
//
// Prints a single JSON object on stdout. The lastWatched parsing mirrors
// scripts/fetch-activity.mjs, and the followers parsing scripts/
// fetch-followers.mjs (tiny parsers kept in sync by hand).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

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

// Pick the profile owner's avatar from the og:image meta tag — the only
// avatar on the page guaranteed to be the owner's (inline <img> avatars can
// belong to other members, and Gravatar/Twitter-sourced avatars don't live
// under /resized/avatar/upload/ at all). The static default on s.ltrbxd.com
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
	// og:image read from the profile in a real browser (see the header note).
	const avatarUrlOverride = flag("--avatar-url");

	const report = { username };

	// Followers page: the count, and the liveness check — it 404s for a handle
	// that doesn't exist, which the blocked profile page can no longer tell us.
	try {
		const html = await get(`https://letterboxd.com/${username}/followers/`);
		report.accountLive = true;
		report.followers = parseFollowers(html, username);
	} catch (err) {
		report.accountLive = !/^404 /.test(err.message);
		report.followersError = err.message;
	}

	// Profile: identity signals + avatar. Expected to 403 — see the header
	// note; the report says so plainly rather than looking like an outage.
	let avatarUrl = avatarUrlOverride;
	try {
		const html = await get(`https://letterboxd.com/${username}/`);
		report.profileStatus = 200;
		Object.assign(report, parseIdentity(html));
		avatarUrl ??= resolveAvatarUrl(html);
	} catch (err) {
		report.profileError = err.message;
		if (/^403 /.test(err.message)) {
			report.profileNote =
				"Profile is Cloudflare-blocked to plain HTTP clients (expected). " +
				"Read og:image / the bio in a browser and pass --avatar-url.";
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
