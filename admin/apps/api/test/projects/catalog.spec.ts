import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CATALOG, findService, findTown, serviceSlugSchema, townSlugSchema } from '../../src/projects/catalog';

const VENDORED = join(__dirname, '..', '..', 'src', 'projects', 'catalog.json');
const SITE_FILE = join(__dirname, '..', '..', '..', '..', '..', 'src', 'data', 'catalog.json');

describe('the service and town catalog', () => {
  const json = JSON.parse(readFileSync(VENDORED, 'utf8')) as typeof CATALOG;

  it('loads the vendored JSON', () => {
    expect(CATALOG).toEqual(json);
    expect(CATALOG.version).toBe(1);
    expect(CATALOG.services.length).toBeGreaterThan(0);
    expect(CATALOG.towns.length).toBeGreaterThan(0);
  });

  it('accepts exactly the catalog service slugs', () => {
    for (const service of json.services) expect(serviceSlugSchema.safeParse(service.slug).success).toBe(true);
    for (const bad of ['', 'not-a-service', 'Drywall-Repair', 'conroe']) expect(serviceSlugSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts exactly the catalog town slugs', () => {
    for (const town of json.towns) expect(townSlugSchema.safeParse(town.slug).success).toBe(true);
    for (const bad of ['', 'atlantis', 'Conroe', 'drywall-repair']) expect(townSlugSchema.safeParse(bad).success).toBe(false);
  });

  it('answers the validation error the API turns into a 400', () => {
    const result = serviceSlugSchema.safeParse('nope');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Unknown service');
  });

  it('finds an entry by slug', () => {
    expect(findService(json.services[0]!.slug)).toEqual(json.services[0]);
    expect(findTown(json.towns[0]!.slug)).toEqual(json.towns[0]);
    expect(findService('nope')).toBeUndefined();
    expect(findTown('nope')).toBeUndefined();
  });

  it('has unique slugs', () => {
    expect(new Set(json.services.map((s) => s.slug)).size).toBe(json.services.length);
    expect(new Set(json.towns.map((t) => t.slug)).size).toBe(json.towns.length);
  });
});

// The site's file is the source; the vendored copy must equal it (run `npm run catalog:sync --workspace=api`).
// Skipped where only admin/ is checked out (the Docker build).
(existsSync(SITE_FILE) ? describe : describe.skip)('the vendored copy', () => {
  it('equals the site catalog (src/data/catalog.json)', () => {
    expect(readFileSync(VENDORED, 'utf8')).toBe(readFileSync(SITE_FILE, 'utf8'));
  });
});
