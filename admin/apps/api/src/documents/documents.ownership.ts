import type { ModelOwnershipDef, UserOwnedModelDef } from '@marinoscar/platform-api/core';

/**
 * The sample `Document` model's entries in the two registries every model
 * belongs to, registered after the platform's by `src/platform/registrations.ts`.
 * They stay when the sharing slice is off, like the table itself.
 *
 * `ownerUserId` is a foreign key to `User` (cascade), so the user-owned data
 * registry needs an entry whose `purge` matches. A document is also an
 * ORGANIZATION's row: the model ownership registry says so (`kind: 'org'`),
 * which is what the row-level-security policy of the migration enforces.
 */
export const DOCUMENT_USER_OWNED_MODELS: readonly UserOwnedModelDef<'Document'>[] = [
  {
    model: 'Document',
    ownerField: 'ownerUserId',
    ownerRelation: 'owner',
    purge: 'delete',
    export: 'include',
    rationale: "The user's own documents: deleted with the user, and part of the user's data export.",
  },
];

export const DOCUMENT_MODEL_OWNERSHIP: readonly ModelOwnershipDef<'Document'>[] = [
  { model: 'Document', kind: 'org', rationale: "A document belongs to the organization it was written in, and is shared inside it; its grants are that organization's rows." },
];
