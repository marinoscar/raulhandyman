import type { ModelOwnershipDef, UserOwnedModelDef } from '@marinoscar/platform-api/core';

/**
 * The handyman site's models in the two registries every model belongs to,
 * registered after the platform's by `src/platform/registrations.ts`.
 *
 * `createdById` / `updatedById` only record who acted (actor fields), and the
 * relations are `onDelete: SetNull`, so `purge: 'detach'`: removing an editor
 * never deletes a project.
 */
export const PROJECT_USER_OWNED_MODELS: readonly UserOwnedModelDef<'Project' | 'ProjectPhoto'>[] = [
  {
    model: 'Project',
    actorFields: ['createdById', 'updatedById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'A project belongs to the organization and its editors; the author and last editor are only recorded, so a project survives the removal of either.',
  },
  {
    model: 'ProjectPhoto',
    actorFields: ['createdById'],
    purge: 'detach',
    export: 'exclude',
    rationale: 'A project photo belongs to the organization; the uploader is only recorded, so the photo survives the removal of the uploader.',
  },
];

export const PROJECT_MODEL_OWNERSHIP: readonly ModelOwnershipDef<'Project' | 'ProjectPhoto' | 'SitePublishState'>[] = [
  { model: 'Project', kind: 'org', rationale: "A project is the organization's portfolio entry, shared by its editors; row-level security isolates it by org_id." },
  { model: 'ProjectPhoto', kind: 'org', rationale: "A project's photo carries its own org_id (composite foreign key to the project); row-level security isolates it." },
  { model: 'SitePublishState', kind: 'org', rationale: "One row per organization recording the state of its site publish; row-level security isolates it." },
];
