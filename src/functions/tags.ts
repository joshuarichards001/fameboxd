// "director" -> "directors" (the tag page's URL path segment).
export const tagSlug = (tag: string) => `${tag}s`;

// "director" -> "Directors", "youtuber" -> "YouTubers".
export const tagLabel = (tag: string) =>
  tag === "youtuber" ? "YouTubers" : `${tag[0].toUpperCase()}${tag.slice(1)}s`;

// The tag's best-known people, named in the intro. Keep in step with
// people.json.
const FEATURED: Record<string, string[]> = {
  actor: ["Anne Hathaway", "Kyle MacLachlan"],
  youtuber: ["Drew Gooden", "TommyInnit"],
  director: ["Martin Scorsese", "Sean Baker"],
  comedian: ["James Acaster", "Ziwe"],
  critic: ["Chris Stuckmann", "David Ehrlich"],
  podcaster: ["Stavros Halkias", "Paul Scheer"],
  musician: ["Ed Sheeran", "Charli XCX"],
  writer: ["R.L. Stine", "Rian Johnson"],
  athlete: ["Bronson Reed", "Brody King"],
  politician: ["Jeremy Corbyn", "Zarah Sultana"],
  developer: ["Josh Richards"],
};

// The tag page's intro, used in the header and as the meta description. A tag
// in use without a FEATURED entry fails the build (see validate.ts).
export const tagIntro = (tag: string, count: number): string | undefined => {
  const featured = FEATURED[tag];
  if (!featured) return undefined;

  let plural = tagSlug(tag);
  if (tag === "youtuber") {
    plural = "YouTubers";
  }

  let who = `${count} famous ${plural} with verified Letterboxd accounts`;
  if (count === 1) {
    who = `1 famous ${tag} with a verified Letterboxd account`;
  }

  let names = featured.join(" and ");
  if (count > featured.length) {
    names = `${featured.join(", ")}, and more`;
  }

  return `${who}. Including ${names}. See what they're watching and rating.`;
};
