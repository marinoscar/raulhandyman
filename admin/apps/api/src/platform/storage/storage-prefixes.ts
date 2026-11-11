// The app's object-storage key prefixes. Declare every prefix a writer of this
// app uses, or `npm run storage:purge` (and the factory reset) leaves its
// objects in the bucket. A prefix is lowercase segments with exactly one
// trailing `/`, and must not overlap another registered prefix.
import type { StorageKeyPrefixDef } from '@marinoscar/platform-api/storage';

/**
 * The minimal example: where files attached to a note would live,
 * `note-attachments/<userId>/...`. Build a key with `buildObjectKey`, never by
 * hand. Delete it with the sample feature.
 */
export const NOTE_ATTACHMENTS_KEY_PREFIX: StorageKeyPrefixDef = {
  id: 'note-attachments',
  prefix: 'note-attachments/',
  owner: 'notes',
  scope: 'user',
  description: 'Files attached to a note, under note-attachments/<userId>/',
};

/** Every prefix this app adds. Append here. */
export const APP_STORAGE_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = [NOTE_ATTACHMENTS_KEY_PREFIX];
