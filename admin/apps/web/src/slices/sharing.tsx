// The sharing slice, on the web: the Groups settings page and a group's detail
// page (members, invites), and the PUBLIC link page at `/s` that resolves a
// shared link (`/s#lnk_...`). The token is read from the URL fragment and sent
// in a header, never in a request URL.
//
// A feature page shares one of its records with `<ShareDialog resource=... />`
// (`@marinoscar/platform-web/sharing/ui`); a resource type the link page can
// show registers a renderer in `registerAppLinkRenderers` below.
import { freezeLinkRenderers } from '@marinoscar/platform-web/sharing/headless';
import { groupsSettingsPage } from '@marinoscar/platform-web/sharing/ui';
import { lazy } from 'react';

import { platformApi } from '../api';
import type { WebSlice } from './slice';

const GroupsPage = lazy(() => import('@marinoscar/platform-web/sharing/ui').then((m) => ({ default: m.GroupsPage })));
const GroupDetailPage = lazy(() => import('@marinoscar/platform-web/sharing/ui').then((m) => ({ default: m.GroupDetailPage })));
const PublicLinkPage = lazy(() => import('@marinoscar/platform-web/sharing/ui').then((m) => ({ default: m.PublicLinkPage })));

/**
 * Registers this app's link renderers, then freezes the registry (a renderer
 * registered later throws instead of quietly changing a public page). The
 * starter ships no shareable resource type, so every link shows the neutral
 * "This link is not available" message. To show one, before the freeze:
 * `registerLinkRenderer('album', PublicAlbumView)`.
 */
export function registerAppLinkRenderers(): void {
  freezeLinkRenderers();
}

export const sharingWebSlice: WebSlice = {
  id: 'sharing',
  setup: registerAppLinkRenderers,
  routes: [
    { path: 'settings/groups', permission: 'groups:read', element: <GroupsPage /> },
    { path: 'settings/groups/:id', permission: 'groups:read', element: <GroupDetailPage /> },
  ],
  // Outside the sign-in gate: a link's holder need not have an account. No host is mounted there, so the transport is passed directly.
  publicRoutes: [{ path: 's', element: <PublicLinkPage apiClient={platformApi} /> }],
  userCards: [{ group: 'Sharing', cards: [{ ...groupsSettingsPage.card, Icon: groupsSettingsPage.Icon }] }],
};
