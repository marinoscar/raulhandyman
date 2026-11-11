export interface LintIssue {
  code: string;
  field: string;
  message: string;
  photoId?: string;
}
export interface LintResult {
  errors: LintIssue[];
  warnings: LintIssue[];
  /** 0-100: 100 minus 12 per error and 4 per warning. */
  score: number;
}
export interface LintProjectInput {
  id?: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  body: string;
  coverPhotoId: string | null;
  serviceSlug: string;
  townSlug: string;
  completedOn: string | Date | null;
}
export interface LintPhotoInput {
  id: string;
  role: 'before' | 'after' | 'progress' | 'detail' | (string & {});
  altText: string;
  caption: string;
  fileSlug: string;
  processingStatus: 'pending' | 'processing' | 'ready' | 'failed' | (string & {});
  qualityFlags: readonly string[];
  privacyFlags: readonly string[];
}
export interface LintSiblingInput {
  id: string;
  slug: string;
  previousSlugs: readonly string[];
  title: string;
  metaDescription: string;
  status: 'draft' | 'published' | 'archived' | (string & {});
}
export interface LintCatalog {
  services: ReadonlyArray<{ slug: string; name: string; seoName: string }>;
  towns: ReadonlyArray<{ slug: string; name: string }>;
}
export declare const LIMITS: {
  readonly title: { readonly min: number; readonly max: number };
  readonly seoTitle: { readonly min: number; readonly max: number };
  readonly meta: { readonly min: number; readonly max: number };
  readonly slug: { readonly min: number; readonly max: number };
  readonly altMin: number;
  readonly bodyMinWords: number;
  readonly bodyGoodWords: number;
  readonly photosMin: number;
};
export declare const SLUG_PATTERN: RegExp;
/**
 * Pure SEO lint. `siblings` are the organization's other projects (the current one is ignored by id);
 * `catalog` is optional and enables the town and service name warnings.
 */
export declare function lintProject(
  project: LintProjectInput,
  photos: readonly LintPhotoInput[],
  siblings: readonly LintSiblingInput[],
  catalog?: LintCatalog,
): LintResult;
