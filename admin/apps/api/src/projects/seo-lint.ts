// The SEO lint lives in `@app/shared` so the web editor runs the very same
// function; the API enforces it on publish and returns it with a project.
export { lintProject, LIMITS as SEO_LINT_LIMITS, SLUG_PATTERN } from '@app/shared/seo-lint';
export type {
  LintCatalog,
  LintIssue,
  LintPhotoInput,
  LintProjectInput,
  LintResult,
  LintSiblingInput,
} from '@app/shared/seo-lint';
