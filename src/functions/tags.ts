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

// The tag page's intro, used in the header and as the meta description. A tag
// page is otherwise a strict subset of "/", so this is the only copy unique to
// it — a tag in use without one fails the build (see validate.ts). The names
// are hand-picked; keep them in step with people.json.
const INTROS: Record<string, string> = {
  actor:
    "Actors with Letterboxd accounts. Including Anne Hathaway, Kyle MacLachlan, and more.",
  youtuber:
    "YouTubers with Letterboxd accounts. Including Anthony Fantano, TommyInnit, and more.",
  director:
    "Directors with Letterboxd accounts. Including Martin Scorsese, Francis Ford Coppola, and more.",
  comedian:
    "Comedians with Letterboxd accounts. Including James Acaster, Ziwe, and more.",
  critic:
    "Critics with Letterboxd accounts. Including Chris Stuckmann, David Ehrlich, and more.",
  podcaster:
    "Podcasters with Letterboxd accounts. Including Paul Scheer, Chris Ryan, and more.",
  musician:
    "Musicians with Letterboxd accounts. Including Paul McCartney, Ed Sheeran, and more.",
  writer:
    "Writers with Letterboxd accounts. Including R.L. Stine, Rian Johnson, and more.",
  athlete:
    "Athletes with Letterboxd accounts. Including Bronson Reed, Brody King, and more.",
  politician:
    "Politicians with Letterboxd accounts. Including Jeremy Corbyn and Zarah Sultana.",
  developer: "Developers with Letterboxd accounts. Including Josh Richards.",
};

export const tagIntro = (tag: string): string | undefined => INTROS[tag];
