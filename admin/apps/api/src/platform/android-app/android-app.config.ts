// The Android companion, configured once: trusted apps and
// `/.well-known/assetlinks.json` (the starter's nginx serves the path to the
// API), hosted APK releases in object storage, the `android_app` notification
// channel's sender and the Doctor checks. The Android identity (application id,
// deep-link scheme, APK name) derives from `identity.json` exactly as the
// Gradle build derives it, so the API, the web app, the CLI and the APK name
// the same package.
import { ANDROID_IDENTITY_SOURCE, APP_NAME } from '@app/shared';
import { AndroidAppModule } from '@marinoscar/platform-api/android-app';
import { androidIdentity } from '@marinoscar/platform-contract/android-app';

/** The Android identity every surface shares. */
export const ANDROID_IDENTITY = androidIdentity(ANDROID_IDENTITY_SOURCE);

export const androidAppModule = AndroidAppModule.forRoot({
  appName: APP_NAME,
  apkStem: ANDROID_IDENTITY.apkStem,
  testNotificationLink: '/',
});
