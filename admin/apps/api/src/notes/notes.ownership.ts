import type { ModelOwnershipDef, UserOwnedModelDef } from '@marinoscar/platform-api/core';

/**
 * The app's user-owned models (core's user-owned data registry), registered
 * after the platform's by `src/platform/registrations.ts`. Every foreign key
 * to `User` in the composed schema needs an entry whose `purge` matches the
 * relation's `onDelete` (`Cascade` is `delete`); the `userOwnedData`
 * conformance suite fails otherwise. `forUser()` clients confine queries on
 * these models to the caller.
 */
export const APP_USER_OWNED_MODELS: readonly UserOwnedModelDef<'Note'>[] = [
  {
    model: 'Note',
    ownerField: 'userId',
    purge: 'delete',
    export: 'include',
    rationale: "The user's own notes: deleted with the user, and part of the user's data export.",
  },
];

/** The app's models' ownership kinds (core's model ownership registry), after the platform's. */
export const APP_MODEL_OWNERSHIP: readonly ModelOwnershipDef<'Note'>[] = [
  { model: 'Note', kind: 'user', rationale: 'A note is personal to the user who wrote it; no organization.' },
];
