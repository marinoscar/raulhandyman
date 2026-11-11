// The Android companion slice, on the web: the admin page (trusted apps, hosted
// APK releases, a test push), the "update available" banner shown ONLY inside the
// Android app's Trusted Web Activity, and the launch capture that remembers the
// installed build before the router drops the `?source=twa&appVersion=...`
// parameters. The Kotlin shell is built by the CLI's `android` command.
import { ANDROID_IDENTITY_SOURCE } from '@app/shared';
import { androidIdentity, captureTwaLaunch } from '@marinoscar/platform-web/android-app/headless';
import { AndroidUpdateBanner, androidAppSettingsPage } from '@marinoscar/platform-web/android-app/ui';
import { lazy } from 'react';

import type { WebSlice } from './slice';

const AndroidAppPage = lazy(() => import('@marinoscar/platform-web/android-app/ui').then((m) => ({ default: m.AndroidAppPage })));

/** The Android identity every surface shares (derived from identity.json like the Gradle build derives it). */
export const ANDROID_IDENTITY = androidIdentity(ANDROID_IDENTITY_SOURCE);

function UpdateBanner() {
  return <AndroidUpdateBanner keyPrefix={ANDROID_IDENTITY.storagePrefix} />;
}

export const androidAppWebSlice: WebSlice = {
  id: 'android-app',
  setup: () => captureTwaLaunch(undefined, ANDROID_IDENTITY.storagePrefix),
  banners: [UpdateBanner],
  // `system_settings:read` is the exact string `GET /api/admin/android-app` enforces; writes are gated inside the page.
  routes: [{ path: 'admin/settings/android', permission: 'system_settings:read', element: <AndroidAppPage /> }],
  adminCards: [{ group: 'General', cards: [{ ...androidAppSettingsPage.card, Icon: androidAppSettingsPage.Icon }] }],
};
