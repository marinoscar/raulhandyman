// The SEO lint of a project: a PURE function (no I/O, no clock, no randomness),
// shared by the API (it enforces the errors on publish) and the web editor (it
// shows the same checklist live), so the two can never disagree. Imported as
// `import { lintProject } from '@app/shared'` (or `@app/shared/seo-lint`).
// Rules and codes: GitHub issue "SEO lint service, publish/unpublish".

/** Length bounds the rules use; exported so the UI can show counters. */
const LIMITS = Object.freeze({
  title: Object.freeze({ min: 10, max: 70 }),
  seoTitle: Object.freeze({ min: 30, max: 60 }),
  meta: Object.freeze({ min: 70, max: 155 }),
  slug: Object.freeze({ min: 3, max: 70 }),
  altMin: 15,
  bodyMinWords: 60,
  bodyGoodWords: 150,
  photosMin: 2,
});

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ALT_EXTENSION = /\.(jpe?g|png|webp)$/i;
const ALT_CAMERA_PREFIX = /^(IMG_|DSC)/i;
const ERROR_WEIGHT = 12;
const WARNING_WEIGHT = 4;

function text(value) {
  return typeof value === 'string' ? value : '';
}
function norm(value) {
  return text(value).trim().toLowerCase();
}
/** Words that carry a letter or a digit (markdown punctuation does not count). */
function countWords(value) {
  return text(value)
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}
function contains(haystack, needle) {
  return needle.trim().length > 0 && norm(haystack).includes(norm(needle));
}

/**
 * @param {object} project   `{ id?, title, seoTitle, metaDescription, slug, body, coverPhotoId, serviceSlug, townSlug, completedOn }`
 * @param {object[]} photos  `{ id, role, altText, caption, fileSlug, processingStatus, qualityFlags, privacyFlags }`
 * @param {object[]} siblings the org's OTHER projects: `{ id, slug, previousSlugs, title, metaDescription, status }`
 * @param {object} [catalog] `{ services: [{ slug, name, seoName }], towns: [{ slug, name }] }`: enables the town and service name warnings
 * @returns {{ errors: object[], warnings: object[], score: number }}
 */
function lintProject(project, photos, siblings, catalog) {
  const errors = [];
  const warnings = [];
  const error = (code, field, message, photoId) => errors.push(photoId ? { code, field, message, photoId } : { code, field, message });
  const warn = (code, field, message, photoId) => warnings.push(photoId ? { code, field, message, photoId } : { code, field, message });
  const others = (siblings || []).filter((sibling) => sibling.id !== project.id);
  const list = photos || [];

  const title = text(project.title).trim();
  if (title.length < LIMITS.title.min) error('title.missing', 'title', `Title must be at least ${LIMITS.title.min} characters.`);
  else if (title.length > LIMITS.title.max) error('title.too_long', 'title', `Title must be at most ${LIMITS.title.max} characters.`);

  const seoTitle = text(project.seoTitle).trim();
  if (seoTitle.length < LIMITS.seoTitle.min || seoTitle.length > LIMITS.seoTitle.max) {
    error('seo_title.length', 'seoTitle', `SEO title must be ${LIMITS.seoTitle.min}-${LIMITS.seoTitle.max} characters (now ${seoTitle.length}).`);
  }

  const meta = text(project.metaDescription).trim();
  if (meta.length < LIMITS.meta.min || meta.length > LIMITS.meta.max) {
    error('meta.length', 'metaDescription', `Meta description must be ${LIMITS.meta.min}-${LIMITS.meta.max} characters (now ${meta.length}).`);
  }

  const slug = text(project.slug);
  if (!SLUG_PATTERN.test(slug) || slug.length < LIMITS.slug.min || slug.length > LIMITS.slug.max) {
    error('slug.invalid', 'slug', `Slug must be lowercase letters, digits and hyphens, ${LIMITS.slug.min}-${LIMITS.slug.max} characters.`);
  }
  if (others.some((sibling) => sibling.slug === slug || (sibling.previousSlugs || []).includes(slug))) {
    error('slug.duplicate', 'slug', 'Another project already uses this slug (or used it before).');
  }

  const published = others.filter((sibling) => sibling.status === 'published');
  if (title && published.some((sibling) => norm(sibling.title) === norm(title))) {
    error('title.duplicate', 'title', 'A published project has the same title.');
  }
  if (meta && published.some((sibling) => norm(sibling.metaDescription) === norm(meta))) {
    error('meta.duplicate', 'metaDescription', 'A published project has the same meta description.');
  }

  const cover = project.coverPhotoId ? list.find((photo) => photo.id === project.coverPhotoId) : undefined;
  if (!cover || cover.processingStatus !== 'ready') error('cover.missing', 'coverPhotoId', 'Choose a cover photo that has finished processing.');

  for (const photo of list) {
    const alt = text(photo.altText).trim();
    if (alt.length < LIMITS.altMin) error('photo.alt_missing', 'altText', `Alt text needs at least ${LIMITS.altMin} characters.`, photo.id);
    if (alt && (ALT_EXTENSION.test(alt) || ALT_CAMERA_PREFIX.test(alt) || (text(photo.fileSlug) && norm(alt) === norm(photo.fileSlug)))) {
      error('photo.alt_filename', 'altText', 'Alt text looks like a file name; describe the photo instead.', photo.id);
    }
    if (photo.processingStatus !== 'ready') error('photo.not_ready', 'processingStatus', 'The photo has not finished processing.', photo.id);
  }

  const words = countWords(project.body);
  if (words < LIMITS.bodyMinWords) error('body.missing', 'body', `The description needs at least ${LIMITS.bodyMinWords} words (now ${words}).`);
  else if (words < LIMITS.bodyGoodWords) warn('body.short', 'body', `Aim for ${LIMITS.bodyGoodWords}+ words (now ${words}).`);

  const town = catalog && (catalog.towns || []).find((item) => item.slug === project.townSlug);
  if (town) {
    if (!contains(seoTitle, town.name)) warn('seo_title.town_missing', 'seoTitle', `Mention ${town.name} in the SEO title.`);
    if (!contains(title, town.name)) warn('title.town_missing', 'title', `Mention ${town.name} in the title.`);
  }
  const service = catalog && (catalog.services || []).find((item) => item.slug === project.serviceSlug);
  if (service && !contains(seoTitle, service.name) && !contains(seoTitle, service.seoName)) {
    warn('seo_title.service_missing', 'seoTitle', `Mention ${service.name} in the SEO title.`);
  }

  if (list.length < LIMITS.photosMin) warn('photos.few', 'photos', `Add at least ${LIMITS.photosMin} photos.`);
  if (list.some((photo) => photo.role === 'before') && !list.some((photo) => photo.role === 'after')) {
    warn('photos.before_without_after', 'photos', 'There is a before photo but no after photo.');
  }
  for (const photo of list) {
    if ((photo.privacyFlags || []).length > 0) warn('photo.privacy_flags', 'privacyFlags', 'Review the privacy flags on this photo.', photo.id);
    if ((photo.qualityFlags || []).length > 0) warn('photo.quality_flags', 'qualityFlags', 'Review the quality flags on this photo.', photo.id);
    if (text(photo.caption).trim() === '') warn('photo.caption_empty', 'caption', 'Add a caption.', photo.id);
  }
  if (!project.completedOn) warn('completed_on.missing', 'completedOn', 'Add the completion date.');

  const score = Math.max(0, 100 - errors.length * ERROR_WEIGHT - warnings.length * WARNING_WEIGHT);
  return { errors, warnings, score };
}

exports.LIMITS = LIMITS;
exports.SLUG_PATTERN = SLUG_PATTERN;
exports.lintProject = lintProject;
