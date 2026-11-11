// Every optional slice the starter can mount, as data. Importing this file
// runs nothing (each definition is an object of lazy loaders), so adding a
// slice here costs a disabled app nothing. Which of them mount is
// `packages/shared/slices.json`; `./manifest.ts` validates and resolves it.
//
// To remove a slice's code from the app for good: delete its `src/platform/<id>/`
// folder, its line below and its id from `SLICE_IDS` (`./slice.ts`), and the
// web side's `src/slices/<id>.tsx`. To only switch it off, remove its id from
// `slices.json` and nothing else.
import { aiSlice } from '../ai/ai.slice';
import { androidAppSlice } from '../android-app/android-app.slice';
import { credentialsSlice } from '../credentials/credentials.slice';
import { dbBackupSlice } from '../db-backup/db-backup.slice';
import { emailSlice } from '../email/email.slice';
import { exportsSlice } from '../exports/exports.slice';
import { notificationsSlice } from '../notifications/notifications.slice';
import { onboardingSlice } from '../onboarding/onboarding.slice';
import { sharingSlice } from '../sharing/sharing.slice';
import { storageSlice } from '../storage/storage.slice';
import { telemetrySlice } from '../telemetry/telemetry.slice';
import type { ApiSlice, SliceId } from './slice';

export const ALL_SLICES: Readonly<Record<SliceId, ApiSlice>> = {
  credentials: credentialsSlice,
  storage: storageSlice,
  email: emailSlice,
  notifications: notificationsSlice,
  sharing: sharingSlice,
  ai: aiSlice,
  'db-backup': dbBackupSlice,
  exports: exportsSlice,
  onboarding: onboardingSlice,
  'android-app': androidAppSlice,
  telemetry: telemetrySlice,
};
