// Runs after `astro build`: writes .br (quality 11) and .gz (level 9) next to
// every text asset in dist/, and generates dist/_redirects.map for nginx from
// src/content/redirects.json (empty map when that file is absent).
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url).pathname;
const REDIRECTS = new URL('../src/content/redirects.json', import.meta.url).pathname;
const EXT = new Set(['.html', '.css', '.js', '.xml', '.txt', '.svg', '.json', '.webmanifest']);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function normalize(redirects) {
  // Accept [{from,to}], {from: to} or [[from,to]]
  if (Array.isArray(redirects)) {
    return redirects.map((r) => (Array.isArray(r) ? r : [r.from ?? r.old ?? r.source, r.to ?? r.new ?? r.target]));
  }
  if (redirects && typeof redirects === 'object') return Object.entries(redirects);
  return [];
}

async function writeRedirectMap() {
  let pairs = [];
  try {
    pairs = normalize(JSON.parse(await readFile(REDIRECTS, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`redirects.json: ${e.message}`);
  }
  const q = (s) => {
    if (typeof s !== 'string' || !s.startsWith('/') || /["\;\s{}$]/.test(s)) {
      throw new Error(`Unsafe redirect path: ${JSON.stringify(s)}`);
    }
    return `"${s}"`;
  };
  const lines = pairs.map(([from, to]) => {
    const f = from.endsWith('/') ? from : `${from}/`;
    return `${q(f)} ${q(to)};`;
  });
  await writeFile(join(DIST, '_redirects.map'), lines.length ? lines.join('\n') + '\n' : '');
  return lines.length;
}

let files = 0;
let rawBytes = 0;
let brBytes = 0;
for await (const p of walk(DIST)) {
  if (!EXT.has(extname(p))) continue;
  const buf = await readFile(p);
  const br = brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  });
  await writeFile(`${p}.br`, br);
  await writeFile(`${p}.gz`, gzipSync(buf, { level: 9 }));
  files++;
  rawBytes += buf.length;
  brBytes += br.length;
}
const n = await writeRedirectMap();
console.log(`compress: ${files} files (${(rawBytes / 1024).toFixed(0)} KB -> ${(brBytes / 1024).toFixed(0)} KB br), ${n} redirects`);
