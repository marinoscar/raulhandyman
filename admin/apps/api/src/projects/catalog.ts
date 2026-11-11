import { z } from 'zod';

import catalogJson = require('./catalog.json');

/**
 * The service and town catalog the public site and this API share. The JSON is
 * `src/data/catalog.json` of the site repository, vendored here by
 * `npm run catalog:sync` (a test fails when the two copies differ) so the
 * Docker image, whose build context is `admin/`, carries it. Services stay
 * code-owned by the site: this module only reads identifiers.
 */
export interface CatalogService {
  slug: string;
  name: string;
  seoName: string;
  tag: string;
}
export interface CatalogTown {
  name: string;
  slug: string;
  core: boolean;
}
export interface Catalog {
  version: number;
  services: CatalogService[];
  towns: CatalogTown[];
}

export const CATALOG: Catalog = catalogJson as Catalog;

function slugsOf(items: ReadonlyArray<{ slug: string }>, what: string): [string, ...string[]] {
  const slugs = items.map((item) => item.slug);
  if (slugs.length === 0) throw new Error(`catalog.json lists no ${what}`);
  if (new Set(slugs).size !== slugs.length) throw new Error(`catalog.json lists a ${what} slug twice`);
  return slugs as [string, ...string[]];
}

/** Accepts only a service slug of the catalog. */
export const serviceSlugSchema = z.enum(slugsOf(CATALOG.services, 'services'), { error: 'Unknown service' });
/** Accepts only a town slug of the catalog. */
export const townSlugSchema = z.enum(slugsOf(CATALOG.towns, 'towns'), { error: 'Unknown town' });

export function findService(slug: string): CatalogService | undefined {
  return CATALOG.services.find((service) => service.slug === slug);
}
export function findTown(slug: string): CatalogTown | undefined {
  return CATALOG.towns.find((town) => town.slug === slug);
}
