// The AI feature behind the photo retouch (`projects.photo.retouch`,
// `src/projects/ai/`). Needs an image-editing model (a `gpt-image` family model
// enabled in Admin, AI, Models). Registered by `ai.slice.ts` before bootstrap.
import type { AiFeatureDefinition } from '@marinoscar/platform-api/ai';

/** The feature id: usage rows in Admin, AI, Usage carry it. Stable: never reuse it. */
export const PROJECTS_RETOUCH_FEATURE_ID = 'projects_retouch';

export const PROJECTS_RETOUCH_FEATURE: AiFeatureDefinition = {
  id: PROJECTS_RETOUCH_FEATURE_ID,
  label: 'Photo retouch',
  group: 'Projects',
  needs: ['image_edit'],
  inputModalities: ['image'],
  providers: null,
};
