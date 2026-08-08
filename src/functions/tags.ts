// "director" -> "directors" (the tag page's URL path segment).
export const tagSlug = (tag: string) => `${tag}s`;

// "director" -> "Director", "youtuber" -> "YouTuber".
export const tagLabelSingular = (tag: string) =>
  tag === "youtuber" ? "YouTuber" : `${tag[0].toUpperCase()}${tag.slice(1)}`;

// "director" -> "Directors", "youtuber" -> "YouTubers".
export const tagLabel = (tag: string) => `${tagLabelSingular(tag)}s`;

export const tagPageTitle = (tag: string, count: number) =>
  `${count} ${tagLabel(tag)} on Letterboxd | Fameboxd`;

// Each tag page's header line, reused as its meta description. Every card on a
// tag page also appears on "/", so this line is the only text unique to the
// URL: keep them hand-written and distinct, near 155 characters so search
// results don't truncate them. A tag in use with no entry here fails the build
// (see validate.ts).
const INTROS: Record<string, (count: number) => string> = {
  director: (count) =>
    `${count} film directors with public Letterboxd accounts, from Martin Scorsese and Francis Ford Coppola to Sean Baker. See what they're watching now.`,
  actor: (count) =>
    `${count} actors with public Letterboxd accounts, including Anne Hathaway, Kyle MacLachlan, Iman Vellani and Rachel Sennott. Updated daily with their latest watches.`,
  youtuber: (count) =>
    `${count} YouTubers with public Letterboxd accounts, from video essayists like Thomas Flight to Drew Gooden, Kurtis Conner and TommyInnit. Refreshed daily.`,
  comedian: (count) =>
    `${count} comedians with public Letterboxd accounts, including James Acaster, Ziwe, Stavros Halkias and Paul Scheer. See their latest ratings and reviews.`,
  critic: (count) =>
    `${count} film critics with public Letterboxd accounts, including David Ehrlich, Katie Walsh, Chris Stuckmann and Sean Fennessey. Updated daily.`,
  podcaster: (count) =>
    `${count} podcasters with public Letterboxd accounts, including Paul Scheer, Stavros Halkias, Griffin Newman and The Ringer's Sean Fennessey.`,
  musician: (count) =>
    `${count} musicians with public Letterboxd accounts, including Charli XCX, Ed Sheeran, Paul McCartney and Kid Cudi. See what they're watching and rating.`,
  writer: (count) =>
    `${count} screenwriters and authors with public Letterboxd accounts, including R.L. Stine, Rian Johnson, Mike Flanagan and Christopher McQuarrie.`,
  athlete: (count) =>
    `${count} athletes with public Letterboxd accounts, including WWE's Bronson Reed, AEW's Brody King and footballer-turned-filmmaker Alfie Whiteman.`,
  politician: (count) =>
    `${count} politicians with public Letterboxd accounts: Jeremy Corbyn and Zarah Sultana, both British MPs who log and rate films publicly.`,
  developer: (count) =>
    `${count} developer with a public Letterboxd account: Josh Richards, who built this directory. See what he's been watching lately.`,
};

export const tagIntro = (tag: string, count: number): string | undefined =>
  INTROS[tag]?.(count);

export const hasTagIntro = (tag: string): boolean => tag in INTROS;
