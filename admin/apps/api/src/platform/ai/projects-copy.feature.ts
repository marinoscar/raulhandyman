// The AI feature behind project copy and alt-text suggestions
// (`projects.ai.suggest`, `src/projects/ai/`). Declared here, like
// `notes-summary.feature.ts`, and registered by `ai.slice.ts` before bootstrap.
import type { AiFeatureDefinition } from '@marinoscar/platform-api/ai';

/** The feature id: usage rows in Admin, AI, Usage carry it. Stable: never reuse it. */
export const PROJECTS_COPY_FEATURE_ID = 'projects_copy';

export const PROJECTS_COPY_FEATURE: AiFeatureDefinition = {
  id: PROJECTS_COPY_FEATURE_ID,
  label: 'Project copy & alt text',
  group: 'Projects',
  needs: ['responses', 'structured_output'],
  inputModalities: ['image'],
  providers: null,
};
