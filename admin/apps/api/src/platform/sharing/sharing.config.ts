// =============================================================================
// The app's binding of the sharing slice
// =============================================================================
//
// `@marinoscar/platform-api/sharing`: groups inside an organization, their
// members and invites (`/api/groups`), the ownership contract for group-owned
// rows, grants and link shares. Routes are guarded by the app's own `@Auth()`
// (`platformHost`); every app capability comes through the host ports
// `SharingHostModule` binds; the membership cache shares the JWT principal
// cache's TTL (`AUTH_PRINCIPAL_CACHE_TTL_SECONDS`) so the two expire together;
// link URLs are on the deployment's `APP_URL`.
// =============================================================================

import { parsePrincipalCacheTtlSeconds } from '@marinoscar/platform-api/identity';
import { SharingModule } from '@marinoscar/platform-api/sharing';

import { platformHost } from '../host';
import { SharingHostModule } from './sharing-host.module';

export const sharingModule = SharingModule.forRoot({
  host: platformHost,
  imports: [SharingHostModule],
  groups: {
    membershipCacheTtlSeconds: parsePrincipalCacheTtlSeconds(process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS),
  },
  // The share URL is `${APP_URL}/s#lnk_...`, read when a link is built. The
  // lifetimes, caps and the miss throttle keep their defaults.
  links: {
    appUrl: () => process.env.APP_URL || 'http://localhost:3535',
  },
});
