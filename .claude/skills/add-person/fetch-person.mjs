// Helper for the `add-person` skill. Given a Letterboxd username it:
//   • fetches the most recent diary entry (lastWatched) from the RSS feed,
//   • scrapes identity signals from the public profile (display name + the
//     meta description, which lists film counts, favorites, and bio) so the
//     caller can verify the handle really belongs to the named person —
//     usernames get recycled, so a handle from a listicle may now be someone
//     else, and
//   • optionally downloads the profile avatar and converts it to a 160×160
//     .webp (the site's avatar convention).
//
// It writes NOTHING to people.json — the skill instructions handle that.
//
// Usage:
//   node fetch-person.mjs <username>                      # read-only report
//   node fetch-person.mjs <username> --avatar-out <path>  # also save avatar
//
// Prints a single JSON object on stdout. The lastWatched parsing mirrors
// scripts/fetch-activity.mjs (a tiny parser kept in sync by hand).

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
	const i = rest.indexOf("--avatar-out");
	const avatarOut = i !== -1 ? rest[i + 1] : null;

	const report = { username };

	// Profile: identity signals + avatar.
	try {
		const html = await get(`https://letterboxd.com/${username}/`);
		report.profileStatus = 200;
		Object.assign(report, parseIdentity(html));
		const avatarUrl = resolveAvatarUrl(html);
		report.avatarSourceUrl = avatarUrl;
		report.hasCustomAvatar = Boolean(avatarUrl);
		if (avatarOut) {
			try {
				report.avatarSaved = avatarUrl
					? await saveAvatar(avatarUrl, avatarOut)
					: null;
			} catch (err) {
				// A Gravatar-backed profile whose Gravatar no longer exists
				// 404s (we ask for default=404 on purpose) — monogram it.
				if (!/^404 /.test(err.message)) throw err;
				report.avatarSaved = null;
				report.hasCustomAvatar = false;
			}
			if (!report.avatarSaved)
				report.avatarNote =
					"No custom avatar; the site will render a monogram.";
		}
	} catch (err) {
		report.profileError = err.message;
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
