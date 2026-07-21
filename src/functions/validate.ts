import type { Person } from "./people";

const VOCAB = new Set([
	"actor",
	"director",
	"writer",
	"youtuber",
	"critic",
	"musician",
	"comedian",
	"podcaster",
	"athlete",
]);

// Build-time data validation (fails the build on bad data).
export function validatePeople(people: Person[]): void {
	const seen = new Set<string>();
	for (const p of people) {
		if (typeof p.name !== "string" || p.name.trim() === "") {
			throw new Error(`Entry missing a valid "name": ${JSON.stringify(p)}`);
		}
		if (typeof p.username !== "string" || !/^[a-z0-9_]+$/.test(p.username)) {
			throw new Error(`Entry "${p.name}" has an invalid username: ${p.username}`);
		}
		if (seen.has(p.username)) {
			throw new Error(`Duplicate username: ${p.username}`);
		}
		seen.add(p.username);
		if (typeof p.description !== "string" || p.description.trim() === "") {
			throw new Error(`Entry "${p.name}" is missing a description.`);
		}
		if (!Array.isArray(p.tags) || p.tags.length < 1 || p.tags.length > 3) {
			throw new Error(`Entry "${p.name}" must have 1–3 tags.`);
		}
		for (const tag of p.tags) {
			if (!VOCAB.has(tag)) {
				throw new Error(`Entry "${p.name}" has an out-of-vocabulary tag: ${tag}`);
			}
		}
	}
}
