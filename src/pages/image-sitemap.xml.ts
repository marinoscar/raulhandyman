// Google image sitemap: one <url> per project page with its final optimised image URLs.
import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { getProjects, projectPath } from '../data/projects';
import { business } from '../data/site';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const GET: APIRoute = async ({ site }) => {
  const projects = await getProjects();
  const urls: string[] = [];
  for (const p of projects) {
    const images: string[] = [];
    for (const ph of p.photos) {
      // Same transform as the detail page's schema images, so the URL is the emitted file.
      const img = await getImage({ src: ph.renditions.master, width: 1600, format: 'jpg' });
      images.push(
        `    <image:image>\n      <image:loc>${esc(new URL(img.src, site).href)}</image:loc>\n` +
          (ph.caption ? `      <image:caption>${esc(ph.caption)}</image:caption>\n` : '') +
          `      <image:title>${esc(ph.altText)}</image:title>\n    </image:image>`,
      );
    }
    urls.push(`  <url>\n    <loc>${business.url}${projectPath(p)}</loc>\n${images.join('\n')}\n  </url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
