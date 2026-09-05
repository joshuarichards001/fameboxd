// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import people from "./src/data/people.json" with { type: "json" };
import { activity, personPageUrl } from "./src/functions/activity.ts";
import { filmPages, filmPageUrl } from "./src/functions/films.ts";
import { tagSlug } from "./src/functions/tags.ts";

// <lastmod> per page, taken from the newest watch logged by the people on it.
// The daily activity refresh moves these, which is the freshness signal the
// sitemap previously gave Google none of. Deliberately not the build time — a
// sitemap where every URL changes on every build teaches Google to ignore it.
//
// The dates come from activity.json rather than each person's `lastWatched`,
// because that is what the pages themselves render, and the same helpers the
// router uses decide which URLs exist: if this file's idea of the page set
// drifted from theirs, the sitemap would advertise 404s.

// Watch dates are user-entered, so one typo'd 2030 would park a lastmod in the
// future — worse than a stale one — on that person's page and every film,
// tag and index page they appear on. Anything after the day the data was
// fetched is ignored. Bounding by that rather than by today keeps two builds
// of the same commit identical.
const dataDate = activity.generatedAt.slice(0, 10);

const newestIn = (entries) =>
  entries.reduce(
    (latest, e) =>
      e.watchedDate && e.watchedDate <= dataDate && e.watchedDate > latest
        ? e.watchedDate
        : latest,
    "",
  );

// Empty-diary people have no date at all; their page keeps its <loc> and drops
// the <lastmod>, which is optional per the sitemap spec.
const newestByPerson = new Map(
  people.map((p) => [p.username, newestIn(activity.people[p.username] ?? [])]),
);
const newestAmong = (subset) =>
  subset.reduce((latest, p) => {
    const d = newestByPerson.get(p.username) ?? "";
    return d > latest ? d : latest;
  }, "");

const sitewide = newestAmong(people);
const LASTMOD = new Map([
  ["/", sitewide],
  // Both list every person's newest watch, so they move whenever anything does.
  ["/recent/", sitewide],
  ["/films/", sitewide],
]);
for (const tag of new Set(people.flatMap((p) => p.tags))) {
  LASTMOD.set(
    `/${tagSlug(tag)}/`,
    newestAmong(people.filter((p) => p.tags.includes(tag))),
  );
}
for (const p of people) {
  LASTMOD.set(personPageUrl(p.username), newestByPerson.get(p.username) ?? "");
}
// Only the films with a page: filmPages() is what the route generates from.
for (const film of filmPages()) {
  LASTMOD.set(filmPageUrl(film.slug), newestIn(film.watchers.map((w) => w.entry)));
}

// https://astro.build/config
export default defineConfig({
  site: "https://fameboxd.com",
  integrations: [
    sitemap({
      serialize(item) {
        const date = LASTMOD.get(new URL(item.url).pathname);
        if (date) item.lastmod = new Date(`${date}T00:00:00Z`).toISOString();
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
