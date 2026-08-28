// JSON-LD for each page type. Base.astro carries WebSite and Organization on
// every page and appends whatever a page hands it in `schema`; everything here
// builds nodes for that array.
//
// Every node carries an absolute @id built from the page it lives on, so nodes
// reference each other instead of repeating themselves: the Person in the
// directory listing, on their own page and in a film's watcher list is one
// entity with one @id.
//
// Deliberately absent: aggregateRating on Movie. That property means "how this
// film is rated"; ours means "how the handful of the 163 people here who rated
// it rated it". Emitting it invites Google to present our figure as the film's
// own, which misleads users and misrepresents the data. The average stays
// visible on the page, labelled with its denominator.

import { personPageUrl } from "./activity";
import { filmPageUrl, filmTitle, letterboxdFilmUrl, type Film } from "./films";
import { profileUrl, type Person } from "./people";

const abs = (site: URL, path: string) => new URL(path, site).href;

// The WebSite node Base.astro emits on every page, for pages to point at.
const websiteId = (site: URL) => `${abs(site, "/")}#website`;

const personId = (site: URL, username: string) =>
	`${abs(site, personPageUrl(username))}#person`;

// A person as they appear in someone else's list. Every person in the
// directory has a page, so `url` is unconditional.
function personRef(site: URL, p: Person) {
	return {
		"@type": "Person",
		"@id": personId(site, p.username),
		name: p.name,
		alternateName: `@${p.username}`,
		url: abs(site, personPageUrl(p.username)),
		sameAs: profileUrl(p.username),
	};
}

const listItems = (site: URL, people: Person[]) =>
	people.map((p, i) => ({
		"@type": "ListItem",
		position: i + 1,
		item: personRef(site, p),
	}));

// Google renders these, so the trail has to match the real URL hierarchy —
// no intermediate levels that have no page (/people/ has no index).
const breadcrumbs = (
	page: string,
	trail: { name: string; url: string }[],
) => ({
	"@type": "BreadcrumbList",
	"@id": `${page}#breadcrumb`,
	itemListElement: trail.map((step, i) => ({
		"@type": "ListItem",
		position: i + 1,
		name: step.name,
		item: step.url,
	})),
});

// "/" and the tag pages: a list of named people, in rendered order, rather
// than the wall of text a crawler would otherwise see.
export function directorySchema(opts: {
	site: URL;
	pathname: string;
	name: string;
	description: string;
	people: Person[];
}): object[] {
	const { site, pathname, name, description, people } = opts;
	const page = abs(site, pathname);
	return [
		{
			"@type": "CollectionPage",
			"@id": `${page}#webpage`,
			url: page,
			name,
			description,
			isPartOf: { "@id": websiteId(site) },
			mainEntity: { "@id": `${page}#list` },
		},
		{
			"@type": "ItemList",
			"@id": `${page}#list`,
			name,
			numberOfItems: people.length,
			itemListElement: listItems(site, people),
		},
	];
}

export function personPageSchema(opts: {
	site: URL;
	person: Person;
	hasAvatar: boolean;
}): object[] {
	const { site, person, hasAvatar } = opts;
	const page = abs(site, personPageUrl(person.username));
	return [
		{
			"@type": "ProfilePage",
			"@id": `${page}#webpage`,
			url: page,
			name: `${person.name} on Letterboxd`,
			isPartOf: { "@id": websiteId(site) },
			breadcrumb: { "@id": `${page}#breadcrumb` },
			mainEntity: { "@id": personId(site, person.username) },
		},
		{
			...personRef(site, person),
			description: person.description,
			...(hasAvatar
				? { image: abs(site, `/avatars/${person.username}.webp`) }
				: {}),
			// The follower count is the one number that says how big this account
			// is; FollowAction is the only honest way to say so in schema.
			...(person.followers != null
				? {
						interactionStatistic: {
							"@type": "InteractionCounter",
							interactionType: "https://schema.org/FollowAction",
							userInteractionCount: person.followers,
						},
					}
				: {}),
		},
		breadcrumbs(page, [
			{ name: "Fameboxd", url: abs(site, "/") },
			{ name: person.name, url: page },
		]),
	];
}

// The film itself, and — separately — the people here who logged it. Keeping
// them as two nodes is the point: our data is about the watchers, not about
// how the film is rated.
export function filmPageSchema(opts: {
	site: URL;
	film: Film;
	watchers: Person[];
}): object[] {
	const { site, film, watchers } = opts;
	const page = abs(site, filmPageUrl(film.slug));
	const heading = filmTitle(film);
	return [
		{
			"@type": "Movie",
			"@id": `${page}#film`,
			url: page,
			name: film.title,
			...(film.year != null ? { dateCreated: String(film.year) } : {}),
			mainEntityOfPage: page,
			sameAs: [
				letterboxdFilmUrl(film.slug),
				...(film.tmdb != null
					? [`https://www.themoviedb.org/movie/${film.tmdb}`]
					: []),
			],
		},
		{
			"@type": "ItemList",
			"@id": `${page}#watchers`,
			name: `Celebrities who logged ${heading}`,
			numberOfItems: watchers.length,
			itemListElement: listItems(site, watchers),
		},
		breadcrumbs(page, [
			{ name: "Fameboxd", url: abs(site, "/") },
			{ name: "Films", url: abs(site, "/films/") },
			{ name: heading, url: page },
		]),
	];
}
