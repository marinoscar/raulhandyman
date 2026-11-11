// The sharing slice: groups inside an organization (members, invites),
// record grants to a user or a group, link shares and the public link route.
// The web side is the Groups settings page and the `/s` public link page.
// Group invitations and share notices go out through the notifications slice.
// The sample shareable record is the `document` (`documents/`): see `resource-types.ts`.
import type { ApiSlice } from '../slices/slice';

export const sharingSlice: ApiSlice = {
  id: 'sharing',
  permissionSlices: ['sharing'],
  contribute: () => {
    const { SHARING_NOTIFICATIONS, SHARING_EMAIL_TEMPLATES } = require('./sharing.notifications') as typeof import('./sharing.notifications');
    return { notifications: SHARING_NOTIFICATIONS, emailTemplates: SHARING_EMAIL_TEMPLATES };
  },
  // The `$queryRaw` of the document list's EXISTS form (above 1,000 shared records).
  rawSql: [{ file: 'platform/sharing/documents/documents.service.ts', why: 'The document list pages ids in SQL with the sharing slice\'s `accessibleWhere` EXISTS form above 1,000 shared records.' }],
  userData: () => {
    const { groupMembershipRemovalHook } = require('@marinoscar/platform-api/user-data') as typeof import('@marinoscar/platform-api/user-data');
    // The last-admin rule runs before a user row is deleted.
    return { userRemovalHooks: [groupMembershipRemovalHook] };
  },
  register: () => {
    const { registerResourceType } = require('@marinoscar/platform-api/sharing') as typeof import('@marinoscar/platform-api/sharing');
    const { APP_RESOURCE_TYPES } = require('./resource-types') as typeof import('./resource-types');
    for (const type of APP_RESOURCE_TYPES) registerResourceType(type);
  },
  modules: () => {
    const { sharingModule } = require('./sharing.config') as typeof import('./sharing.config');
    const { DocumentsModule } = require('./documents/documents.module') as typeof import('./documents/documents.module');
    return [sharingModule, DocumentsModule];
  },
};
