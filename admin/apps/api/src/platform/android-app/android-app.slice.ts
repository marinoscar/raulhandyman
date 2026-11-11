// The Android companion slice: a Trusted Web Activity shell over this web app,
// its trust (digital asset links), APK releases hosted by the deployment, and
// Web Push to the Android app's own subscriptions. The Kotlin shell itself is
// built from `@marinoscar/platform-infra`'s `android/` sources by the CLI's
// `android` command; this slice is the server half. Admin page: `/admin/settings/android`.
import type { ApiSlice } from '../slices/slice';

export const androidAppSlice: ApiSlice = {
  id: 'android-app',
  contribute: () => {
    const android = require('@marinoscar/platform-api/android-app') as typeof import('@marinoscar/platform-api/android-app');
    // `android-releases/`: kept by the factory reset.
    return { storagePrefixes: [android.ANDROID_RELEASES_KEY_PREFIX_DEF] };
  },
  register: () => {
    const { androidDeviceSourceRegistry } = require('@marinoscar/platform-api/android-app') as typeof import('@marinoscar/platform-api/android-app');
    const { EMPTY_DEVICE_SOURCE, registerEmptyDeviceSource } = require('./device-source') as typeof import('./device-source');
    if (!androidDeviceSourceRegistry.has(EMPTY_DEVICE_SOURCE.id)) registerEmptyDeviceSource();
  },
  modules: () => {
    const { androidAppModule } = require('./android-app.config') as typeof import('./android-app.config');
    return [androidAppModule];
  },
};
