import { registerSystemSettingsNamespaces, type SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

import {
  PROJECTS_SETTINGS_DEFAULTS,
  projectsSettingsPatchSchema,
  projectsSettingsSchema,
  type ProjectsSettings,
  type ProjectsSettingsPatch,
} from './projects.settings.schemas';

/**
 * The `projects` namespace of the system settings document: brand values for
 * the branded OG image and the strength of the photo grade. One deployment
 * serves one business, so the system document (not the org settings layer)
 * is the natural home. `GET/PATCH /api/system-settings` carry it; the photo
 * job reads it with `getNamespace('projects')` on every run, so a change
 * applies to the next processed photo. Registered by src/platform/platform.ts
 * before `SettingsModule.forRoot()` composes the request bodies.
 */
export const PROJECTS_SYSTEM_SETTINGS = {
  key: 'projects',
  description: 'Projects: brand values for OG images and the photo grade.',
  storedSchema: projectsSettingsSchema,
  patchSchema: projectsSettingsPatchSchema,
  putSchema: projectsSettingsSchema,
  wirePatchSchema: projectsSettingsPatchSchema,
  responseSchema: projectsSettingsSchema,
  defaults: PROJECTS_SETTINGS_DEFAULTS,
  requiredOnPut: false,
  merge: (current: ProjectsSettings, patch: ProjectsSettingsPatch | undefined): ProjectsSettings => ({
    brand: { ...current.brand, ...stripUndefined(patch?.brand) },
    grade: { ...current.grade, ...stripUndefined(patch?.grade) },
    og: { ...current.og, ...stripUndefined(patch?.og) },
  }),
} satisfies SystemSettingsNamespace<'projects', ProjectsSettings, ProjectsSettingsPatch>;

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
}

registerSystemSettingsNamespaces([PROJECTS_SYSTEM_SETTINGS as unknown as SystemSettingsNamespace]);

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    projects: ProjectsSettings;
  }
}
