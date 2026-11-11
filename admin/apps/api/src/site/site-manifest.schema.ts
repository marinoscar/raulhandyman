// The Zod side of the site content manifest contract (issue #27).
//
// `src/content/manifest.schema.json` at the repository root (JSON Schema 2020-12)
// is the SOURCE OF TRUTH and is frozen: any change bumps `manifestVersion` and
// updates both sides. This file mirrors it field for field; the parity test
// `test/site/manifest-schema-parity.spec.ts` validates the fixture and a set of
// negative cases with BOTH and fails when they disagree.
//
// Placed in the API (not `packages/shared`) because `@app/shared` is a
// dependency-free CommonJS package (`index.js` + `.d.ts`) with no `zod`
// dependency, and only the API produces the manifest.
//
// Every object is strict (`additionalProperties: false`): a private field
// (`workNotes`, user ids, storage keys, `aiSuggestion`) that leaks into the
// serialised value makes `.parse` throw instead of reaching the site.
import { z } from 'zod';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MEDIA_PATH = /^media\/[A-Za-z0-9._/-]+\.(jpg|jpeg|png|webp|avif)$/;
const PROJECT_URL = /^\/projects\/[a-z0-9-]+\/$/;

const uuid = z.string().regex(UUID);
const slug = z.string().regex(SLUG).max(120);
const mediaPath = z.string().regex(MEDIA_PATH);
const positiveInt = z.number().int().min(1);

export const manifestRedirectSchema = z.strictObject({
  from: z.string().regex(PROJECT_URL),
  to: z.string().regex(PROJECT_URL),
});

export const manifestRenditionSchema = z.strictObject({
  path: mediaPath,
  width: positiveInt,
  height: positiveInt,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const manifestPhotoSchema = z.strictObject({
  id: uuid,
  role: z.enum(['before', 'after', 'progress', 'detail']),
  sortOrder: z.number().int().min(0),
  altText: z.string().min(1).max(300),
  caption: z.string().max(500).nullable().optional(),
  fileSlug: slug,
  width: positiveInt,
  height: positiveInt,
  dominantColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  focal: z
    .strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .nullable()
    .optional(),
  renditions: z.strictObject({
    master: manifestRenditionSchema,
    card4x3: manifestRenditionSchema,
    hero16x9: manifestRenditionSchema,
  }),
});

export const manifestProjectSchema = z.strictObject({
  id: uuid,
  slug,
  title: z.string().min(1).max(120),
  seoTitle: z.string().max(70).nullable(),
  metaDescription: z.string().min(1).max(200),
  summary: z.string().min(1).max(300),
  bodyMarkdown: z.string(),
  serviceSlug: slug,
  townSlug: slug,
  townName: z.string().min(1),
  completedOn: z.iso.date().nullable(),
  publishedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  featured: z.boolean(),
  cover: uuid,
  ogImage: z.strictObject({ path: mediaPath, width: positiveInt, height: positiveInt }),
  photos: z.array(manifestPhotoSchema).min(1),
});

export const siteManifestSchema = z.strictObject({
  manifestVersion: z.literal(1),
  contentVersion: z.string().min(1),
  generatedAt: z.iso.datetime({ offset: true }),
  indexNowKey: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,128}$/)
    .nullable()
    .optional(),
  projects: z.array(manifestProjectSchema),
  redirects: z.array(manifestRedirectSchema),
});

export type SiteManifest = z.infer<typeof siteManifestSchema>;
export type ManifestProject = z.infer<typeof manifestProjectSchema>;
export type ManifestPhoto = z.infer<typeof manifestPhotoSchema>;

/** The renditions a client may request from `GET /api/site/media/:photoId/:rendition`. */
export const SITE_MEDIA_RENDITIONS = ['master', 'card4x3', 'hero16x9', 'og-branded'] as const;
export type SiteMediaRendition = (typeof SITE_MEDIA_RENDITIONS)[number];
