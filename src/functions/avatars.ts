import { readdirSync } from "node:fs";
import path from "node:path";

// Which people have a self-hosted avatar (public/avatars/<username>.webp).
// The filenames are the single source of truth — read the directory at build
// time rather than maintaining a separate manifest. Everyone else gets a
// generated initials monogram; no external requests either way.
export function loadAvatarSet(): Set<string> {
	const avatarsDir = path.join(process.cwd(), "public", "avatars");
	return new Set(
		readdirSync(avatarsDir)
			.filter((f) => f.endsWith(".webp"))
			.map((f) => f.slice(0, -".webp".length)),
	);
}

export function initials(name: string): string {
	const words = name.replace(/&/g, " ").split(/\s+/).filter(Boolean);
	const letters = words
		.slice(0, 2)
		.map((w) => w[0])
		.join("");
	return (letters || name[0] || "?").toUpperCase();
}

// Deterministic hue per name so each initials chip has its own (consistent) color.
export function hueFor(name: string): number {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
	return h;
}
