// The Android companion's device source. The starter's Android shell has no
// native capability, so no paired device reports anything and the Android app
// page's "reported apps" list is empty. An app with a native module (a health
// sync, a media sync) registers a source that groups its own device table by
// (packageName, signingSha256), counts active devices and takes their latest
// sighting; `devicesBehind` is optional. Replace this one then.
import { registerAndroidDeviceSource, type AndroidDeviceSource } from '@marinoscar/platform-api/android-app';

export const EMPTY_DEVICE_SOURCE: AndroidDeviceSource = {
  id: 'starter-shell',
  reportedApps: async () => [],
};

/** Registers {@link EMPTY_DEVICE_SOURCE} once. */
export function registerEmptyDeviceSource(): void {
  registerAndroidDeviceSource(EMPTY_DEVICE_SOURCE);
}
