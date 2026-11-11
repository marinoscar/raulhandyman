#!/usr/bin/env node
// `npm run catalog:sync`: copies the site's service/town catalog
// (<repo>/src/data/catalog.json, the single source the public site and this API
// share) into src/projects/catalog.json, the vendored copy the API reads and the
// Docker image carries (the admin build context is `admin/`, so the file one
// level above it is not reachable there). `--check` exits 1 when the two differ.
// When the site file is absent (the Docker build) the vendored copy stands.
const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '../../../../src/data/catalog.json');
const target = path.resolve(__dirname, '../src/projects/catalog.json');
const check = process.argv.includes('--check');

if (!fs.existsSync(source)) {
  console.log(`catalog:sync: ${source} not found; keeping the vendored copy.`);
  process.exit(0);
}
const wanted = fs.readFileSync(source, 'utf8');
const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
if (wanted === current) {
  console.log('catalog:sync: vendored catalog is up to date.');
  process.exit(0);
}
if (check) {
  console.error('catalog:sync: src/projects/catalog.json differs from src/data/catalog.json. Run `npm run catalog:sync --workspace=api`.');
  process.exit(1);
}
fs.writeFileSync(target, wanted);
console.log('catalog:sync: updated src/projects/catalog.json.');
