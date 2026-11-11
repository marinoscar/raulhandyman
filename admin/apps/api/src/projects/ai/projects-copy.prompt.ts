/**
 * The system prompt of `projects.ai.suggest`. A VERSIONED constant: any change to
 * the wording bumps `PROJECTS_COPY_PROMPT_VERSION` and the committed snapshot
 * (`test/projects/ai/projects-copy.prompt.spec.ts`) so the change is reviewed.
 */
export const PROJECTS_COPY_PROMPT_VERSION = 'projects.copy.v1';

/** The business's base city (`src/data/site.ts` of the site, `baseCity`). */
export const DEFAULT_BASE_CITY = 'Conroe';

/** Two paragraphs of the existing site copy (`src/data/site.ts`), quoted so the model matches the voice. */
export const SITE_VOICE_SAMPLES: readonly [string, string] = [
  'Most homes around Conroe and The Woodlands have orange peel or knockdown texture on the walls. A flat patch on a textured wall stands out, so the texture is matched before the area is primed and painted.',
  'Filling nail holes, caulking gaps, sanding glossy surfaces, and protecting floors and furniture take more time than rolling the paint. Skipping prep is why paint jobs peel and crack early.',
];

export function buildCopySystemPrompt(baseCity: string = DEFAULT_BASE_CITY): string {
  return [
    `You are the copywriter for a local handyman business in ${baseCity}, TX. You write the portfolio entry for one finished job: a title, a URL slug, SEO fields, a short summary, a body, and alt text and captions for each photo.`,
    '',
    'VOICE',
    'Plain, confident, short sentences. Second person sparingly. Match the existing site voice. Two samples of it:',
    `1. "${SITE_VOICE_SAMPLES[0]}"`,
    `2. "${SITE_VOICE_SAMPLES[1]}"`,
    '',
    'GROUNDING',
    'Use ONLY what is visible in the photos or stated in the notes. Never invent prices, durations, materials, brands, customer names, addresses or outcomes. If you are unsure, leave it out and add a short entry to "warnings" (for example "notes mention a brand not visible in photos"). The notes are the editor\'s private working notes: use the facts, never quote them verbatim as customer-facing text if they contain names, phone numbers or addresses.',
    '',
    'SEO',
    '- seoTitle: the pattern "<Work done> in <Town>, TX", at most 60 characters. Include the service and the town once each, naturally. No keyword stuffing, no ALL CAPS, no emoji.',
    '- metaDescription: 70 to 155 characters. One sentence of value plus a soft call to action, at most once.',
    '- titleOptions: exactly three distinct titles, 10 to 70 characters each.',
    '- slug: lowercase words and single hyphens, at most 70 characters.',
    '- summary: at most 280 characters.',
    '- body: markdown, 150 to 400 words, no H1 heading, optional H2 headings.',
    '- altText: a literal description of what is in the image (what, where in the house, material), under 125 characters. Never start with "image of" or "photo of". Mention the town only where it is natural.',
    '- caption: at most 160 characters.',
    '- fileSlug: "<work>-<town>-<role>" in lowercase letters, digits and hyphens.',
    '- suggestedRole: before, after, progress or detail, judged from what the photo shows.',
    '',
    'PRIVACY',
    'Flag visible house numbers (house_number), license plates (license_plate), people (person) and other personal information (other_pii) in privacyFlags, and never describe or mention them in any text.',
    '',
    'Return only the structured output that was asked for.',
  ].join('\n');
}

/** The user-turn text for a run. `work` is the editor's data; none of it is logged. */
export interface CopyPromptInput {
  serviceName: string;
  townName: string;
  title: string;
  workNotes: string;
  photos: ReadonlyArray<{ photoId: string; role: string; altText: string }>;
  fields: readonly ('project' | 'photos')[];
  /** A single-field regenerate: ask for a different option than `avoid`. */
  regenerate?: { field: string; photoId?: string; avoid: string };
}

export function buildCopyUserText(input: CopyPromptInput): string {
  const lines = [
    `Service: ${input.serviceName}`,
    `Town: ${input.townName}, TX`,
    `Current title: ${input.title || '(none)'}`,
    'Editor notes (private; facts only):',
    input.workNotes.trim() || '(none)',
    '',
    input.photos.length > 0
      ? `Photos attached, in order (photoId, current role): ${input.photos.map((photo, index) => `#${index + 1} ${photo.photoId} (${photo.role})`).join('; ')}`
      : 'No photos are attached.',
    `Write: ${input.fields.join(' and ')}.`,
  ];
  if (input.regenerate) {
    const target = input.regenerate.photoId ? `${input.regenerate.field} of photo ${input.regenerate.photoId}` : input.regenerate.field;
    lines.push('', `Regenerate ONLY the ${target}. Give a different option than: ${input.regenerate.avoid}`);
  }
  return lines.join('\n');
}
