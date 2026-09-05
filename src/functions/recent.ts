// The newest logged watches across everyone — the one ordering that /recent/
// and /feed.xml both render, so it lives here rather than in either of them.
// Pure over the committed data apart from `today`, which only ever removes
// rows.

import type { ActivityData, DiaryEntry } from "./activity";
import type { Person } from "./people";

// A watch that is safe to place on a timeline: it has a date, and the date is
// not in the future.
export interface DatedEntry extends DiaryEntry {
	watchedDate: string;
}

export interface RecentWatch {
	person: Person;
	entry: DatedEntry;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// Newest first, then name A–Z, then slug — a person logging three films on one
// day is common, so the last tie-break is what keeps two builds identical.
const compare = (a: RecentWatch, b: RecentWatch) =>
	b.entry.watchedDate.localeCompare(a.entry.watchedDate) ||
	a.person.name.localeCompare(b.person.name, "en", { sensitivity: "base" }) ||
	a.entry.slug.localeCompare(b.entry.slug);

export function recentWatches(
	activity: ActivityData,
	people: Person[],
	limit: number,
	today: string = todayISO(),
): RecentWatch[] {
	const byUsername = new Map(people.map((p) => [p.username, p]));
	const watches: RecentWatch[] = [];
	for (const [username, entries] of Object.entries(activity.people)) {
		const person = byUsername.get(username);
		// validateActivity already rejects usernames with no person entry, and
		// every person has a page, so this skip is a belt-and-braces guard
		// against an unlinkable row rather than a filter that fires today.
		if (!person) continue;
		for (const entry of entries) {
			const { watchedDate } = entry;
			// 164 entries carry no date at all, and the rest are user-entered:
			// one typo'd 2027 would pin itself to the top of the page for a year.
			if (!watchedDate || watchedDate > today) continue;
			watches.push({ person, entry: { ...entry, watchedDate } });
		}
	}
	return watches.sort(compare).slice(0, limit);
}
