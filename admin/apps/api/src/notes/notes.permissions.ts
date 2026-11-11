/**
 * The notes module's permissions, as data (the app's part of
 * `src/platform/permissions.ts`: registered and seeded after the platform's). The exact strings the controller enforces
 * and the web card declares.
 */
export const NOTES_PERMISSIONS = {
  NOTES_READ: {
    id: 'notes:read',
    description: 'Read own notes',
    scope: 'org',
    defaultGrants: ['contributor', 'viewer', 'org_admin'],
  },
  NOTES_WRITE: {
    id: 'notes:write',
    description: 'Create, edit and delete own notes',
    scope: 'org',
    defaultGrants: ['contributor', 'org_admin'],
  },
} as const;
