import { registerSystemSettingsNamespaces, type SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

import { notesSettingsPatchSchema, notesSettingsSchema, type NotesSettings } from './notes.schemas';

/**
 * The `notes` namespace of the system settings document: one declaration,
 * registered before `SettingsModule.forRoot()` composes the request bodies
 * (src/platform/platform.ts imports this file first). `GET/PATCH
 * /api/system-settings` then carry it, and the archive job and the Doctor
 * check read it with `getNamespace('notes')`: the stored value, salvaged
 * field by field, or these defaults.
 */
export const NOTES_SYSTEM_SETTINGS = {
  key: 'notes',
  description: 'Notes: when an untouched note is archived.',
  storedSchema: notesSettingsSchema,
  patchSchema: notesSettingsPatchSchema,
  putSchema: notesSettingsSchema,
  wirePatchSchema: notesSettingsPatchSchema,
  responseSchema: notesSettingsSchema,
  defaults: { archiveAfterDays: 0 },
  requiredOnPut: false,
  merge: (current, patch) => ({ archiveAfterDays: patch?.archiveAfterDays ?? current.archiveAfterDays }),
} satisfies SystemSettingsNamespace<'notes', NotesSettings, Partial<NotesSettings>>;

registerSystemSettingsNamespaces([NOTES_SYSTEM_SETTINGS as SystemSettingsNamespace]);

// Types `SystemSettingsService.getNamespace('notes')` as `NotesSettings`.
// Augment the package's public specifier, never a deeper path.
// `getNamespace(NOTES_SYSTEM_SETTINGS)` is typed without this block too.
declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    notes: NotesSettings;
  }
}
