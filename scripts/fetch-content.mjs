// Prebuild step: turns the published content manifest into local files Astro can optimise.
//
//   Mode A  CONTENT_API_URL + (CONTENT_API_TOKEN_FILE | CONTENT_API_TOKEN): GET /api/site/content,
//           then download every rendition from /api/site/media/<path>.
//   Mode B  otherwise: use fixtures/content (or CONTENT_FIXTURE_DIR). CI always uses this mode.
//           FIXTURE_MULTIPLY=N repeats the fixture projects N times (pagination tests only).
//
// Writes (all git-ignored and regenerated): src/content/projects/<slug>.json,
// src/assets/projects/<slug>/*.jpg, src/content/redirects.json, public/<indexNowKey>.txt.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  schema: join(root, 'src/content/manifest.schema.json'),
  projects: join(root, 'src/content/projects'),
  assets: join(root, 'src/assets/projects'),
  redirects: join(root, 'src/content/redirects.json'),
  publicDir: join(root, 'public'),
  cache: join(root, 'src/assets/projects/.cache.json'),
};

const apiUrl = (process.env.CONTENT_API_URL || '').replace(/\/+$/, '');
let token = process.env.CONTENT_API_TOKEN || '';
if (process.env.CONTENT_API_TOKEN_FILE) token = (await readFile(process.env.CONTENT_API_TOKEN_FILE, 'utf8')).trim();
const modeA = Boolean(apiUrl && token);

const redact = (s) => (token ? String(s).split(token).join('[redacted]') : String(s));
const fail = (msg) => {
  console.error(`fetch-content: ${redact(msg)}`);
  process.exit(1);
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- load manifest ----
let manifest;
let fixtureDir = '';
if (modeA) {
  console.log(`fetch-content: fetching ${apiUrl}/api/site/content`);
  try {
    const res = await fetch(`${apiUrl}/api/site/content`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (!res.ok) fail(`GET /api/site/content returned HTTP ${res.status}`);
    manifest = await res.json();
  } catch (e) {
    fail(`could not fetch content: ${e.message}`);
  }
} else {
  fixtureDir = process.env.CONTENT_FIXTURE_DIR
    ? resolve(process.cwd(), process.env.CONTENT_FIXTURE_DIR)
    : join(root, 'fixtures/content');
  console.warn('\n========================================');
  console.warn(' fetch-content: Using fixture content');
  console.warn(` (${relative(root, fixtureDir) || fixtureDir}; set CONTENT_API_URL and a token for real content)`);
  console.warn('========================================\n');
  manifest = JSON.parse(await readFile(join(fixtureDir, 'manifest.json'), 'utf8'));
  const n = Number(process.env.FIXTURE_MULTIPLY || 1);
  if (n > 1) manifest.projects = multiply(manifest.projects, n);
}

function multiply(projects, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (const p of projects) {
      if (i === 0) { out.push(p); continue; }
      const suffix = `-${i + 1}`;
      out.push({
        ...p,
        id: `${p.id.slice(0, -4)}${String(i).padStart(4, '0')}`,
        slug: `${p.slug}${suffix}`,
        title: `${p.title} (${i + 1})`,
        seoTitle: p.seoTitle ? p.seoTitle.replace(' | ', ` ${i + 1} | `) : null,
        metaDescription: `${p.metaDescription} (${i + 1})`,
        publishedAt: new Date(Date.parse(p.publishedAt) - i * 86400000).toISOString().replace('.000Z', 'Z'),
      });
    }
  }
  return out;
}

// ---- validate ----
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(await readFile(P.schema, 'utf8')));
if (!validate(manifest)) {
  const lines = (validate.errors || []).slice(0, 20).map((e) => `  ${e.instancePath || '/'} ${e.message}`);
  fail(`manifest does not match src/content/manifest.schema.json:\n${lines.join('\n')}`);
}
const slugs = new Set();
for (const p of manifest.projects) {
  if (slugs.has(p.slug)) fail(`duplicate project slug "${p.slug}"`);
  slugs.add(p.slug);
  if (!p.photos.some((ph) => ph.id === p.cover)) fail(`project "${p.slug}": cover ${p.cover} is not one of its photos`);
  const fileSlugs = new Set();
  for (const ph of p.photos) {
    if (fileSlugs.has(ph.fileSlug)) fail(`project "${p.slug}": duplicate photo fileSlug "${ph.fileSlug}"`);
    fileSlugs.add(ph.fileSlug);
  }
}

// ---- plan files ----
let cache = {};
try { cache = JSON.parse(await readFile(P.cache, 'utf8')); } catch { /* first run */ }
const jobs = []; // { local, source, sha256?, stamp? }
const local = (slug, name) => `src/assets/projects/${slug}/${name}`;

const projectFiles = manifest.projects.map((p) => {
  const photos = p.photos.map((ph) => {
    const renditions = {};
    for (const [name, r] of Object.entries(ph.renditions)) {
      const dest = local(p.slug, `${ph.fileSlug}-${name}.jpg`);
      jobs.push({ local: dest, source: r.path, sha256: r.sha256 });
      renditions[name] = relative(P.projects, join(root, dest));
    }
    return { ...ph, renditions };
  });
  const ogDest = local(p.slug, 'og-branded.jpg');
  jobs.push({ local: ogDest, source: p.ogImage.path, stamp: p.updatedAt });
  return { ...p, photos, ogImage: relative(P.projects, join(root, ogDest)) };
});

// ---- regenerate output dirs (files whose cache entry still matches are kept) ----
await rm(P.projects, { recursive: true, force: true });
await mkdir(P.projects, { recursive: true });
const keep = new Set(jobs.map((j) => join(root, j.local)));
await prune(P.assets);
async function prune(dir) {
  if (!existsSync(dir)) return;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await prune(full);
      if ((await readdir(full)).length === 0) await rm(full, { recursive: true });
    } else if (full !== P.cache && !keep.has(full)) {
      await rm(full);
    }
  }
}

// ---- download / copy ----
let downloaded = 0;
let skipped = 0;
const newCache = {};
async function bytesFor(job) {
  if (!modeA) return readFile(join(fixtureDir, job.source));
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${apiUrl}/api/site/media/${job.source}`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw new Error(`could not download ${job.source}: ${lastErr.message}`);
}
async function run(job) {
  const dest = join(root, job.local);
  const key = job.sha256 ?? `stamp:${job.stamp}`;
  if (existsSync(dest)) {
    const ok = job.sha256 ? sha256(await readFile(dest)) === job.sha256 : cache[job.local] === key;
    if (ok) { skipped++; newCache[job.local] = key; return; }
  }
  const buf = await bytesFor(job);
  if (job.sha256 && sha256(buf) !== job.sha256) throw new Error(`sha256 mismatch for ${job.source}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  downloaded++;
  newCache[job.local] = key;
}
try {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => { for (let j; (j = queue.shift()); ) await run(j); }));
} catch (e) {
  fail(e.message);
}

// ---- write outputs ----
for (const p of projectFiles) await writeFile(join(P.projects, `${p.slug}.json`), `${JSON.stringify(p, null, 2)}\n`);
await writeFile(P.redirects, `${JSON.stringify(manifest.redirects, null, 2)}\n`);

// IndexNow key file: public by design; the previous one is removed.
if (cache.__indexNowFile && cache.__indexNowFile !== manifest.indexNowKey) await rm(join(P.publicDir, `${cache.__indexNowFile}.txt`), { force: true });
if (manifest.indexNowKey) {
  await writeFile(join(P.publicDir, `${manifest.indexNowKey}.txt`), manifest.indexNowKey);
  newCache.__indexNowFile = manifest.indexNowKey;
}
await mkdir(P.assets, { recursive: true });
await writeFile(P.cache, JSON.stringify(newCache));

console.log(`fetch-content: ${manifest.projects.length} project(s), ${downloaded} file(s) written, ${skipped} unchanged (${modeA ? 'api' : 'fixtures'})`);
