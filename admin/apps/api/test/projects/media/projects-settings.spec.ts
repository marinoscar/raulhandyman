import { composeDefaultSystemSettings, composePatchSystemSettingsSchema, systemSettingsNamespaceRegistry } from '@marinoscar/platform-api/settings';

import '../../../src/platform/platform';
import { PROJECT_MEDIA_KEY_PREFIX, APP_STORAGE_KEY_PREFIXES } from '../../../src/platform/storage/storage-prefixes';
import { PROJECTS_SYSTEM_SETTINGS } from '../../../src/projects/projects.settings';
import { PROJECTS_SETTINGS_DEFAULTS, projectsSettingsPatchSchema, projectsSettingsSchema } from '../../../src/projects/projects.settings.schemas';
import { PHOTO_PROCESS_JOB } from '../../../src/projects/media/photo-process.job';
import { AI_SUGGEST_JOB, PHOTO_RETOUCH_JOB } from '../../../src/projects/ai/projects-ai.constants';
import { STORAGE_KEY_PREFIX_PATTERN } from '@marinoscar/platform-api/storage';

describe('projects settings namespace', () => {
  it('is registered with the system settings and defaults to the site values', () => {
    expect(systemSettingsNamespaceRegistry.ids()).toContain('projects');
    expect(composeDefaultSystemSettings()).toMatchObject({
      projects: {
        brand: { navy: '#0e1f3d', gold: '#d6a84e', businessName: 'Raul Handyman', phoneDisplay: '973-906-9503', logoObjectId: null },
        grade: { warmth: 0.06, saturation: 1.06 },
        og: { enabled: true },
      },
    });
    expect(projectsSettingsSchema.parse(PROJECTS_SETTINGS_DEFAULTS)).toEqual(PROJECTS_SETTINGS_DEFAULTS);
  });

  it('accepts a partial PATCH in the system settings body and merges it per field', () => {
    const body = { projects: { grade: { warmth: 0.1 }, brand: { gold: '#c9a227' } } };
    expect(composePatchSystemSettingsSchema().parse(body)).toEqual(body);
    const merged = PROJECTS_SYSTEM_SETTINGS.merge(PROJECTS_SETTINGS_DEFAULTS, body.projects);
    expect(merged.grade).toEqual({ warmth: 0.1, saturation: 1.06 });
    expect(merged.brand).toEqual({ ...PROJECTS_SETTINGS_DEFAULTS.brand, gold: '#c9a227' });
    expect(merged.og).toEqual({ enabled: true });
    expect(PROJECTS_SYSTEM_SETTINGS.merge(PROJECTS_SETTINGS_DEFAULTS, undefined)).toEqual(PROJECTS_SETTINGS_DEFAULTS);
  });

  it('rejects bad values', () => {
    expect(() => projectsSettingsPatchSchema.parse({ brand: { navy: 'blue' } })).toThrow();
    expect(() => projectsSettingsPatchSchema.parse({ grade: { warmth: 2 } })).toThrow();
    expect(() => projectsSettingsPatchSchema.parse({ brand: { logoObjectId: 'not-a-uuid' } })).toThrow();
    expect(projectsSettingsPatchSchema.parse({ brand: { logoObjectId: null } })).toEqual({ brand: { logoObjectId: null } });
  });
});

describe('project media wiring pins', () => {
  it('declares the project-media prefix once, valid and org-scoped', () => {
    expect(APP_STORAGE_KEY_PREFIXES).toContain(PROJECT_MEDIA_KEY_PREFIX);
    expect(PROJECT_MEDIA_KEY_PREFIX.prefix).toMatch(STORAGE_KEY_PREFIX_PATTERN);
    expect(PROJECT_MEDIA_KEY_PREFIX.scope).toBe('org');
    const prefixes = APP_STORAGE_KEY_PREFIXES.map((def) => def.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('the job type string is permanent', () => {
    expect(PHOTO_PROCESS_JOB).toBe('projects.photo.process');
    expect(AI_SUGGEST_JOB).toBe('projects.ai.suggest');
    expect(PHOTO_RETOUCH_JOB).toBe('projects.photo.retouch');
  });
});
