// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import people from "./src/data/people.json" with { type: "json" };
import { tagSlug } from "./src/functions/tags.ts";

// <lastmod> per page, taken from the newest watch logged by the people on it.
// The daily activity refresh moves these, which is the freshness signal the
// sitemap previously gave Google none of. Deliberately not the build time — a
// sitemap where every URL changes on every build teaches Google to ignore it.
const newest = (subset) =>
  subset.reduce((latest, p) => {
    const d = p.lastWatched?.date;
    return d && d > latest ? d : latest;
  }, "");

const LASTMOD = new Map([["/", newest(people)]]);
for (const tag of new Set(people.flatMap((p) => p.tags))) {
  LASTMOD.set(
    `/${tagSlug(tag)}/`,
    newest(people.filter((p) => p.tags.includes(tag))),
  );
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
