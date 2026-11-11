/**
 * The handyman site's roles and permissions, as data (the app's part of
 * `src/platform/permissions.ts`: registered and seeded after the platform's).
 * The exact strings the controllers enforce.
 *
 * ## Roles
 *
 * - `content_editor` (org): creates, edits and publishes projects. It holds
 *   none of the administration permissions (users, storage config, AI keys,
 *   backups, system settings). It also receives `ai:use`, `storage:read` and
 *   `storage:write` from the platform's sets through `PROJECT_ROLE_GRANTS`
 *   (uploads and AI suggestions work), never a duplicate declaration.
 * - `site_reader` (org): the service role of the site build. It holds only
 *   `site_content:read`.
 *
 * ## Build-token decision (issue #13)
 *
 * A personal access token (PAT) CANNOT be narrowed to one permission: the
 * create DTO is `{ name, durationValue, durationUnit, orgId? }`, a PAT is bound
 * to one organization for its whole life and authenticates as its OWNER with
 * that owner's effective permissions. So the site build token must belong to a
 * DEDICATED SERVICE USER (`site-builder@example.test` is the placeholder used
 * in docs) who is a member of the organization with ONLY the `site_reader` role
 * (`site_content:read`), and the PAT is created while signed in as that user.
 * Compromising the token then exposes published content only. Do not mint the
 * build token from an administrator or editor account.
 * `site_reader` is assignable from the Users and members dialogs like any role.
 */
export const PROJECTS_PERMISSIONS = {
  PROJECTS_READ: {
    id: 'projects:read',
    description: 'List and view projects',
    scope: 'org',
    defaultGrants: ['org_admin', 'content_editor'],
  },
  PROJECTS_WRITE: {
    id: 'projects:write',
    description: 'Create, edit and delete projects and their photos; AI suggestions and retouching',
    scope: 'org',
    defaultGrants: ['org_admin', 'content_editor'],
  },
  PROJECTS_PUBLISH: {
    id: 'projects:publish',
    description: 'Publish and unpublish projects; the Site publishing card',
    scope: 'org',
    defaultGrants: ['org_admin', 'content_editor'],
  },
  SITE_CONTENT_READ: {
    id: 'site_content:read',
    description: 'Read the published content manifest and media (the site build)',
    scope: 'org',
    defaultGrants: ['org_admin', 'site_reader'],
  },
} as const;

/** The app's roles (registered after the platform's). */
export const PROJECTS_ROLES = {
  CONTENT_EDITOR: { id: 'content_editor', description: 'Creates, edits and publishes projects', scope: 'org', label: 'Content editor' },
  SITE_READER: { id: 'site_reader', description: 'Reads published site content (the site build service user)', scope: 'org', label: 'Site reader' },
} as const;

/** Platform permissions the content editor needs on top of the app's own (uploads and AI calls). */
export const PROJECT_ROLE_GRANTS = [{ role: 'content_editor', permissions: ['ai:use', 'storage:read', 'storage:write'] }] as const;
