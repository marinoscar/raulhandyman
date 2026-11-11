// Generates the synthetic fixture content (fixtures/content): images drawn with sharp
// (gradients and flat shapes, no real photos) and the matching manifest.json.
// Run: node scripts/make-fixtures.mjs   (output is committed; rerun only to change fixtures)
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'content');

// Scene painter: returns an SVG string of w x h. `kind` picks the drawing, `tone` the palette.
function scene(kind, w, h, c1, c2) {
  const shapes = {
    fence: Array.from({ length: 9 }, (_, i) => `<rect x="${(w / 9) * i + w * 0.01}" y="${h * 0.3}" width="${w * 0.085}" height="${h * 0.62}" fill="${i % 2 ? c2 : c1}" opacity=".85"/>`).join(''),
    fenceBroken: Array.from({ length: 9 }, (_, i) => `<rect x="${(w / 9) * i + w * 0.01}" y="${h * (0.3 + (i === 4 ? 0.2 : 0))}" width="${w * 0.085}" height="${h * (i === 4 ? 0.42 : 0.62)}" fill="#6b5d4a" opacity=".8" transform="rotate(${i === 4 ? 9 : 0} ${w / 2} ${h * 0.6})"/>`).join(''),
    wall: `<rect x="${w * 0.1}" y="${h * 0.12}" width="${w * 0.8}" height="${h * 0.76}" fill="${c2}" opacity=".5"/><circle cx="${w * 0.55}" cy="${h * 0.5}" r="${h * 0.12}" fill="${c1}" opacity=".9"/>`,
    door: `<rect x="${w * 0.3}" y="${h * 0.08}" width="${w * 0.4}" height="${h * 0.84}" fill="${c2}" opacity=".8"/><rect x="${w * 0.28}" y="${h * 0.06}" width="${w * 0.44}" height="${h * 0.03}" fill="${c1}"/><circle cx="${w * 0.64}" cy="${h * 0.52}" r="${h * 0.025}" fill="${c1}"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes[kind]}</svg>`;
}

async function render(file, kind, w, h, c1, c2) {
  await mkdir(dirname(file), { recursive: true });
  const buf = await sharp(Buffer.from(scene(kind, w, h, c1, c2)))
    .jpeg({ quality: 55, mozjpeg: true })
    .toBuffer();
  await writeFile(file, buf);
  return createHash('sha256').update(buf).digest('hex');
}

const SIZES = { master: [1600, 1200], card4x3: [800, 600], hero16x9: [1280, 720] };

async function photo(id, role, sortOrder, fileSlug, kind, c1, c2, altText, caption) {
  const renditions = {};
  for (const [name, [w, h]] of Object.entries(SIZES)) {
    const path = `media/${id}/${name}.jpg`;
    const sha256 = await render(join(root, path), kind, w, h, c1, c2);
    renditions[name] = { path, width: w, height: h, sha256 };
  }
  return { id, role, sortOrder, altText, caption, fileSlug, width: 1600, height: 1200, dominantColor: c1, focal: { x: 0.5, y: 0.45 }, renditions };
}

async function og(id, c1, c2) {
  const path = `media/${id}/og-branded.jpg`;
  await render(join(root, path), 'wall', 1200, 630, c1, c2);
  return { path, width: 1200, height: 630 };
}

await rm(join(root, 'media'), { recursive: true, force: true });

const ids = {
  p1: '0b6f1d2e-1111-4a11-8a11-000000000001', p2: '0b6f1d2e-2222-4a22-8a22-000000000002', p3: '0b6f1d2e-3333-4a33-8a33-000000000003',
  ph: Array.from({ length: 6 }, (_, i) => `7c1e0a00-0000-4000-8000-00000000000${i + 1}`),
};

const p1photos = [
  await photo(ids.ph[0], 'before', 0, 'fence-before', 'fenceBroken', '#8a7f70', '#5d5446', 'Wooden privacy fence with a leaning, rotted post', 'The leaning post before the repair'),
  await photo(ids.ph[1], 'after', 0, 'fence-after', 'fence', '#a9855a', '#7d6240', 'Wooden privacy fence standing straight with a new post', 'New post set in concrete, boards re-hung'),
  await photo(ids.ph[2], 'detail', 1, 'fence-post-detail', 'fence', '#6f8a73', '#41584a', 'Close view of a new fence post and bracket', 'Post set with a galvanized bracket'),
];
const p2photos = [
  await photo(ids.ph[3], 'after', 0, 'drywall-after', 'wall', '#d8d2c4', '#b9b2a2', 'Smooth painted wall where a hole was patched', 'Patched, textured and painted to match'),
];
const p3photos = [
  await photo(ids.ph[4], 'progress', 0, 'door-progress', 'door', '#9a7b57', '#6d5334', 'Interior door frame with new trim being fitted', null),
  await photo(ids.ph[5], 'after', 1, 'door-after', 'door', '#e9e2d3', '#b8a98a', 'Interior door with new painted trim and casing', 'New casing, caulked and painted'),
];

const projects = [
  {
    id: ids.p1, slug: 'fence-post-replacement-conroe', title: 'Leaning fence post replaced and fence re-hung',
    seoTitle: 'Fence Post Replacement in Conroe, TX | Raul Handyman',
    metaDescription: 'A rotted fence post replaced and the privacy fence boards re-hung straight in Conroe, TX. See the before and after photos.',
    summary: 'A rotted corner post was pulling a section of privacy fence over. New post, new concrete, boards re-hung.',
    bodyMarkdown: '## The problem\n\nOne post had rotted at the base and the whole section leaned toward the yard.\n\n## What was done\n\n- Removed the rotted post and old concrete\n- Set a new treated post in fresh concrete\n- Re-hung the existing boards and replaced two cracked ones\n\nThe fence was stained after a week so the new wood blends in.',
    serviceSlug: 'fence-and-deck-repair', townSlug: 'conroe', townName: 'Conroe', completedOn: '2026-10-02',
    publishedAt: '2026-10-05T14:00:00Z', updatedAt: '2026-10-09T16:30:00Z', featured: true,
    cover: ids.ph[1], ogImage: await og(ids.ph[1], '#a9855a', '#41584a'), photos: p1photos,
  },
  {
    id: ids.p2, slug: 'drywall-hole-patch-the-woodlands', title: 'Doorknob hole patched and painted',
    seoTitle: null,
    metaDescription: 'A doorknob hole in a living room wall patched, textured and painted so the repair disappears. The Woodlands, TX.',
    summary: 'A doorknob-sized hole patched, textured to match and painted.',
    bodyMarkdown: 'The hole was cut back to solid drywall, patched, taped and finished in thin coats. The orange peel texture was matched before priming and painting the full wall for an even color.',
    serviceSlug: 'drywall-repair', townSlug: 'the-woodlands', townName: 'The Woodlands', completedOn: null,
    publishedAt: '2026-09-20T15:00:00Z', updatedAt: '2026-09-20T15:00:00Z', featured: false,
    cover: ids.ph[3], ogImage: await og(ids.ph[3], '#d8d2c4', '#8a7f70'), photos: p2photos,
  },
  {
    id: ids.p3, slug: 'door-casing-replacement-montgomery', title: 'Interior door casing replaced',
    seoTitle: 'Door Casing Replacement in Montgomery, TX | Raul Handyman',
    metaDescription: 'Damaged interior door casing replaced with new trim, caulked and painted in Montgomery, TX.',
    summary: 'Chewed and cracked door casing swapped for new trim, caulked and painted.',
    bodyMarkdown: '## Scope\n\nThe old casing was cracked and pulling away from the wall. It was removed, the gaps filled, and new casing was mitered, nailed, caulked and painted.',
    serviceSlug: 'doors-and-trim', townSlug: 'montgomery', townName: 'Montgomery', completedOn: '2026-08-14',
    publishedAt: '2026-08-18T13:00:00Z', updatedAt: '2026-11-01T12:00:00Z', featured: false,
    cover: ids.ph[5], ogImage: await og(ids.ph[5], '#e9e2d3', '#6d5334'), photos: p3photos,
  },
];

const manifest = {
  manifestVersion: 1,
  contentVersion: createHash('sha256').update(JSON.stringify(projects)).digest('hex'),
  generatedAt: '2026-11-11T00:00:00Z',
  indexNowKey: null,
  projects,
  redirects: [{ from: '/projects/door-trim-fix-montgomery/', to: '/projects/door-casing-replacement-montgomery/' }],
};
await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('fixtures written to', root);
