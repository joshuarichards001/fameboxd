// URL + display metadata for the per-tag pages (/directors/, /actors/, …).

// Plural display labels that plain capitalize-and-append-s gets wrong.
const LABELS: Record<string, string> = {
	youtuber: "YouTubers",
};

// "director" -> "directors" (the tag page's URL path segment).
export const tagSlug = (tag: string) => `${tag}s`;

// "director" -> "Directors", "youtuber" -> "YouTubers".
export const tagLabel = (tag: string) =>
	LABELS[tag] ?? `${tag[0].toUpperCase()}${tag.slice(1)}s`;
