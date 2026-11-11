// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

// Project metadata for sitemap decisions, read from the files scripts/fetch-content.mjs generates.
const projectsDir = new URL('./src/content/projects/', import.meta.url);
/** @type {{ slug: string; serviceSlug: string; updatedAt: string }[]} */
const projects = existsSync(projectsDir)
  ? readdirSync(projectsDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, projectsDir), 'utf8')))
  : [];
const newest = (/** @type {typeof projects} */ list) =>
  list.map((p) => p.updatedAt).sort().at(-1);

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site: 'https://raulhandyman.net',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    inlineStylesheets: 'always',
  },
  compressHTML: true,
  integrations: [
    sitemap({
      // With no projects /projects/ is noindex, so it stays out of the sitemap.
      filter: (page) => !page.includes('/404') && (projects.length > 0 || !new URL(page).pathname.startsWith('/projects/')),
      serialize(item) {
        const path = new URL(item.url).pathname;
        const slug = path.match(/^\/projects\/([^/]+)\/$/)?.[1];
        let last;
        if (path.startsWith('/projects/') && slug && slug !== 'page') last = projects.find((p) => p.slug === slug)?.updatedAt;
        else if (path.startsWith('/projects/')) last = newest(projects);
        else {
          const svc = path.match(/^\/([^/]+)\/$/)?.[1];
          const related = projects.filter((p) => p.serviceSlug === svc);
          if (related.length) last = newest(related);
          else if (path === '/' && projects.length) last = newest(projects);
        }
        if (last) item.lastmod = new Date(last).toISOString();
        return item;
      },
    }),
  ],
});
