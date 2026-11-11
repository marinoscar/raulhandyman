// The sharing slice's sample resource type, without a database: the definition
// is valid (the registry validates it on registration), says what the README's
// walk-through says, and reads its owners and titles through the transaction it
// is handed. The end-to-end behaviour (grants, 404 on denial, the delete rule,
// row-level security) is `documents.db.spec.ts`.
import { registerResourceType, resourceTypeRegistry } from '@marinoscar/platform-api/sharing';

import { DOCUMENT_TYPE, documentResourceType } from '../src/platform/sharing/documents/document.resource-type';
import { APP_RESOURCE_TYPES } from '../src/platform/sharing/resource-types';

describe('the document resource type', () => {
  it('is the one type the app registers, under a permanent id', () => {
    expect(APP_RESOURCE_TYPES.map((type) => type.type)).toEqual(['document']);
    expect(DOCUMENT_TYPE).toBe('document');
  });

  it('is a valid definition: viewer and editor roles, only the owner shares or deletes, a denial is a 404', () => {
    registerResourceType(documentResourceType);
    expect(resourceTypeRegistry.has(DOCUMENT_TYPE)).toBe(true);
    expect(documentResourceType.roles).toEqual(['viewer', 'editor']);
    expect(documentResourceType.actions).toEqual({ read: 'viewer', write: 'editor', share: 'owner', delete: 'owner' });
    expect(documentResourceType.ownership).toBe('user');
    expect(documentResourceType.denyAs).toBe('not_found');
    // No link shares: a link needs a public route, which this example does not mount.
    expect(documentResourceType.grantable?.link).toBeUndefined();
  });

  it("loads each record's organization and owner in ONE query, and omits what does not exist", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'a', orgId: 'org-1', ownerUserId: 'user-1' }]);
    const owners = await documentResourceType.loadOwners(['a', 'missing'], { document: { findMany } } as never);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(owners.get('a')).toEqual({ orgId: 'org-1', owner: { kind: 'user', userId: 'user-1' } });
    expect(owners.has('missing')).toBe(false);
  });

  it('describes a record by its title and page', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'a', title: 'Plan' }]);
    const described = await documentResourceType.describe!(['a'], { document: { findMany } } as never);
    expect(described.get('a')).toEqual({ title: 'Plan', path: '/documents/a' });
  });
});
