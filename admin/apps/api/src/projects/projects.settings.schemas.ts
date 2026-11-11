import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb colour');

/** The brand values the branded OG image is drawn with. Defaults equal the site's current values. */
export const projectsBrandSchema = z.object({
  navy: hexColor,
  gold: hexColor,
  businessName: z.string().trim().min(1).max(80),
  phoneDisplay: z.string().trim().max(40),
  /** A storage object id (an image) drawn at the right of the OG band, or `null` for none. */
  logoObjectId: z.string().uuid().nullable(),
});

/** The photo grade: how strongly the enhance step warms and saturates. */
export const projectsGradeSchema = z.object({
  warmth: z.number().min(0).max(0.3),
  saturation: z.number().min(0.5).max(1.5),
});

export const projectsOgSchema = z.object({ enabled: z.boolean() });

/** The `projects` system settings namespace (Admin, `system_settings:write`). */
export const projectsSettingsSchema = z.object({
  brand: projectsBrandSchema,
  grade: projectsGradeSchema,
  og: projectsOgSchema,
});
export type ProjectsSettings = z.infer<typeof projectsSettingsSchema>;

/** A PATCH body: every group and field optional (the merge is per field). */
export const projectsSettingsPatchSchema = z.object({
  brand: projectsBrandSchema.partial().optional(),
  grade: projectsGradeSchema.partial().optional(),
  og: projectsOgSchema.partial().optional(),
});
export type ProjectsSettingsPatch = z.infer<typeof projectsSettingsPatchSchema>;

/** Defaults equal the site's current brand values (navy/gold palette, grade 0.06 / 1.06). */
export const PROJECTS_SETTINGS_DEFAULTS: ProjectsSettings = {
  brand: { navy: '#0e1f3d', gold: '#d6a84e', businessName: 'Raul Handyman', phoneDisplay: '973-906-9503', logoObjectId: null },
  grade: { warmth: 0.06, saturation: 1.06 },
  og: { enabled: true },
};
