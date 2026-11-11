// The sharing slice's minimal example: ONE shareable resource type. Making a
// table shareable is this one `registerResourceType` call (made at import time
// by `sharing.slice.ts`, before bootstrap); sharing itself then needs no
// further code: `POST /api/grants` and the web `ShareDialog` work for any
// registered type.
//
// A `document` is owned by one user inside one organization, shared as
// `viewer` or `editor` with a member or a group of that organization. Only the
// owner shares or deletes it. A denial is the same 404 as a missing record, so
// a caller cannot tell a document they may not see from one that does not exist.
//
// THE TYPE ID IS PERMANENT once grants of it exist (like a job type): it is
// pinned by `resourceTypeIds` in `test/conformance.spec.ts`.
import type { Prisma } from '@prisma/client';
import type { ResourceDescription, ResourceOwnerInfo, ResourceTypeDef } from '@marinoscar/platform-api/sharing';

/** The resource type id of a document. Permanent. */
export const DOCUMENT_TYPE = 'document';

/** The roles a document can be shared with, weakest first. `'owner'` is implicit. */
export type DocumentRole = 'viewer' | 'editor';

export const documentResourceType: ResourceTypeDef<DocumentRole> = {
  type: DOCUMENT_TYPE,
  roles: ['viewer', 'editor'],
  actions: { read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' },
  ownership: 'user',
  denyAs: 'not_found',
  // ONE query for the whole batch, inside the transaction the slice opened (scoped to the caller's organization).
  async loadOwners(ids, tx) {
    const rows = await (tx as Prisma.TransactionClient).document.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, orgId: true, ownerUserId: true },
    });
    return new Map<string, ResourceOwnerInfo>(rows.map((row) => [row.id, { orgId: row.orgId, owner: { kind: 'user', userId: row.ownerUserId } }]));
  },
  // Titles for "shared with me" and the share notification.
  async describe(ids, tx) {
    const rows = await (tx as Prisma.TransactionClient).document.findMany({ where: { id: { in: [...ids] } }, select: { id: true, title: true } });
    return new Map<string, ResourceDescription>(rows.map((row) => [row.id, { title: row.title, path: `/documents/${row.id}` }]));
  },
};
