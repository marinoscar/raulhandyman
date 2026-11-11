// Post-build quality gate over dist/ (issue #38). Dependency-free, fast.
// Usage: node scripts/check-dist.mjs   (exit 1 on any violation)
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import { brotliCompressSync } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url).pathname;
const MAX_HTML = 50 * 1024;
const MAX_BR = 14 * 1024;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    if (m.index === 0) continue; // tag name handled by regex start
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}(?=[\\s>/])[^>]*>`, 'gi'))].map((m) => m[0]);
const stripScripts = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');

const pages = new Map(); // url path -> {file, html, ids}
const allFiles = new Set();
for await (const f of walk(DIST)) {
  const rel = '/' + relative(DIST, f).split('\\').join('/');
  allFiles.add(rel);
  if (rel.endsWith('.html')) pages.set(rel, { file: rel, html: await readFile(f, 'utf8') });
}
if (!pages.size) {
  console.error('check-dist: no HTML in dist/ (run npm run build first)');
  process.exit(1);
}

const errors = [];
const err = (page, msg) => errors.push(`${page}: ${msg}`);
const urlOf = (rel) => (rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel);

for (const p of pages.values()) {
  p.ids = new Set([...p.html.matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)].map((m) => m[1] ?? m[2] ?? m[3]));
}

const titles = new Map();
const descs = new Map();

for (const [rel, { html }] of pages) {
  const is404 = rel === '/404.html';
  const body = stripScripts(html);

  // size
  const size = Buffer.byteLength(html);
  if (size > MAX_HTML) err(rel, `HTML is ${(size / 1024).toFixed(1)} KB uncompressed (max 50 KB)`);
  const br = brotliCompressSync(Buffer.from(html)).length;
  if (br > MAX_BR) err(rel, `HTML is ${(br / 1024).toFixed(1)} KB brotli (max 14 KB)`);

  // images
  for (const t of tagsOf(body, 'img')) {
    const a = attrs(t);
    const src = a.src ?? '(no src)';
    if (!a.alt || !a.alt.trim()) err(rel, `<img ${src}> missing non-empty alt`);
    if (!a.width) err(rel, `<img ${src}> missing width`);
    if (!a.height) err(rel, `<img ${src}> missing height`);
  }

  // h1
  const h1 = (body.match(/<h1[\s>]/gi) || []).length;
  if (h1 !== 1) err(rel, `expected exactly one <h1>, found ${h1}`);

  // title
  const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = tm ? decode(tm[1]).trim() : '';
  if (!title) err(rel, 'missing <title>');
  else if (title.length < 10 || title.length > 70) err(rel, `<title> is ${title.length} chars (10-70): "${title}"`);
  if (title) (titles.get(title) ?? titles.set(title, []).get(title)).push(rel);

  // description
  const metas = tagsOf(html, 'meta').map(attrs);
  const desc = (metas.find((m) => m.name?.toLowerCase() === 'description')?.content ?? '').trim();
  if (!desc) err(rel, 'missing meta description');
  else if (!is404 && (desc.length < 70 || desc.length > 160)) err(rel, `meta description is ${desc.length} chars (70-160)`);
  if (desc && !is404) (descs.get(desc) ?? descs.set(desc, []).get(desc)).push(rel);

  // canonical (404 must be noindex instead)
  const links = tagsOf(html, 'link').map(attrs);
  const canon = links.find((l) => l.rel?.toLowerCase() === 'canonical');
  if (is404) {
    const robots = metas.find((m) => m.name?.toLowerCase() === 'robots')?.content ?? '';
    if (!/noindex/i.test(robots)) err(rel, '404 page must be noindex');
  } else if (!canon?.href) err(rel, 'missing canonical');

  // scripts
  for (const t of tagsOf(html, 'script')) {
    const a = attrs(t);
    if (a.src) err(rel, `<script src="${a.src}"> is not allowed (no client JS)`);
    else if (a.type && !/^(application\/ld\+json|speculationrules)$/i.test(a.type)) err(rel, `inline <script type="${a.type}"> is not allowed`);
    else if (!a.type) err(rel, 'inline JavaScript is not allowed');
  }

  // JSON-LD
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      for (const node of Array.isArray(data) ? data : [data]) {
        if (!node['@context']) err(rel, 'JSON-LD lacks @context');
        if (!node['@type'] && !node['@graph']) err(rel, 'JSON-LD lacks @type');
      }
    } catch (e) {
      err(rel, `JSON-LD is not valid JSON (${e.message})`);
    }
  }

  // internal links and anchors
  const refs = [];
  for (const t of tagsOf(body, 'a')) refs.push(['a', attrs(t).href]);
  for (const t of tagsOf(html, 'link')) {
    const a = attrs(t);
    if (a.href && !/^(canonical|alternate)$/i.test(a.rel ?? '')) refs.push(['link', a.href]);
  }
  for (const t of tagsOf(body, 'img')) refs.push(['img', attrs(t).src]);
  const base = urlOf(rel);
  for (const [kind, href] of refs) {
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) {
      if (href && /^https?:\/\/(www\.)?raulhandyman\.net/i.test(href) && kind === 'a') {
        // absolute self-links: check like internal
      } else continue;
    }
    let target = href.replace(/^https?:\/\/(www\.)?raulhandyman\.net/i, '') || '/';
    const [pathAndQuery, hash = ''] = target.split('#');
    const path = pathAndQuery.split('?')[0];
    const abs = path === '' ? base : path.startsWith('/') ? path : posix.join(posix.dirname(base + 'x'), path);
    let dest = abs.endsWith('/') ? abs + 'index.html' : abs;
    let found;
    if (allFiles.has(dest)) found = dest;
    else if (!/\.[a-z0-9]+$/i.test(abs) && allFiles.has(abs + '/index.html')) found = abs + '/index.html';
    if (!found) {
      err(rel, `broken ${kind} link: ${href}`);
      continue;
    }
    if (hash && kind === 'a' && found.endsWith('.html') && !pages.get(found).ids.has(decodeURIComponent(hash))) {
      err(rel, `broken anchor: ${href}`);
    }
  }
}

for (const [label, map] of [['title', titles], ['meta description', descs]]) {
  for (const [v, list] of map) if (list.length > 1) errors.push(`duplicate ${label} on ${list.join(', ')}: "${v.slice(0, 80)}"`);
}

if (errors.length) {
  console.error(`check-dist: ${errors.length} problem(s) in ${pages.size} pages`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`check-dist: ${pages.size} pages OK`);
