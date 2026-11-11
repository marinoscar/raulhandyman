/**
 * The FIXED retouch prompt of `projects.photo.retouch`. A versioned constant,
 * snapshot-tested: the options only switch clauses on or off, they never let a
 * caller write prompt text. The protective clauses (never change the work) are
 * not optional and always present.
 */
export const PROJECTS_RETOUCH_PROMPT_VERSION = 'projects.retouch.v1';

export interface RetouchOptions {
  declutter: boolean;
  evenLighting: boolean;
  straighten: boolean;
}

export const DEFAULT_RETOUCH_OPTIONS: RetouchOptions = { declutter: true, evenLighting: true, straighten: true };

const INTRO = 'Edit this real photo of completed home-repair work.';
const DECLUTTER = 'Remove only loose clutter: trash, bins, hoses, cords, tools, ladders, packaging, debris.';
const LIGHTING = 'Even out harsh shadows and exposure.';
const STRAIGHTEN = 'If the horizon or the vertical lines are slightly tilted, level them gently without cropping.';
const GUARD =
  'Do NOT change, add, remove, repair, recolor or restyle any part of the building, walls, floors, fences, decks, doors, trim, fixtures, paint, materials, or the work shown. Do not change the camera angle or composition. Keep it photorealistic. No text, no watermark.';

export function buildRetouchPrompt(options: RetouchOptions = DEFAULT_RETOUCH_OPTIONS): string {
  return [INTRO, options.declutter ? DECLUTTER : null, options.evenLighting ? LIGHTING : null, options.straighten ? STRAIGHTEN : null, GUARD].filter((part): part is string => part !== null).join(' ');
}
