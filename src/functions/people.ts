export interface Person {
	name: string;
	username: string;
	description: string;
	tags: string[];
}

export const profileUrl = (username: string) =>
	`https://letterboxd.com/${username}/`;

// Alphabetical by name (data file is already sorted, but enforce it here).
export function sortPeople(people: Person[]): Person[] {
	return [...people].sort((a, b) =>
		a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
	);
}

// All tags in use, sorted by frequency then alphabetically, for the filter pills.
export function tagsByFrequency(people: Person[]): string[] {
	const tagCounts = new Map<string, number>();
	for (const p of people) {
		for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
	}
	return [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([t]) => t);
}
