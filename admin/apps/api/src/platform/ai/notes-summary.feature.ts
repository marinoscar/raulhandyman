// =============================================================================
// The minimal example of using AI from a feature: summarize a note
// =============================================================================
//
// 1. Declare the feature (what it needs from a model). Registered at import
//    time by `./ai.slice.ts`, before bootstrap.
// 2. Inject the configured `AiModule`'s `AiService` and call
//    `forUser(userId, { orgId, feature })`: the user's own key, else their
//    organization's, else the deployment's pays, under the administrator's
//    policy. The key never reaches this file.
//
// Not wired to a route on purpose: expose it behind `@Auth({ permissions:
// ['ai:use'] })` (and the `AiEnabledGuard` of the AI module) where your feature
// needs it. A job that calls AI is server-only: never give it
// `nodeResultSchema` or `persistNodeResult`.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { AiService, type AiFeatureDefinition } from '@marinoscar/platform-api/ai';

/** The feature id. Stable: never reuse it for something else. */
export const NOTES_SUMMARY_FEATURE_ID = 'notes_summary';

/** One short summary of a note: any model that answers responses. */
export const NOTES_SUMMARY_FEATURE: AiFeatureDefinition = {
  id: NOTES_SUMMARY_FEATURE_ID,
  label: 'Notes: summaries',
  group: 'Notes',
  needs: ['responses'],
  inputModalities: ['text'],
  providers: null,
};

@Injectable()
export class NotesSummaryService {
  constructor(private readonly ai: AiService) {}

  /**
   * One short summary of `text`, for `userId`, in `orgId` (the principal's active organization).
   */
  async summarize(userId: string, text: string, opts: { orgId?: string; model?: string } = {}): Promise<string> {
    const response = await this.ai
      .forUser(userId, { feature: NOTES_SUMMARY_FEATURE_ID, ...(opts.orgId ? { orgId: opts.orgId } : {}) })
      .respond({
        ...(opts.model ? { model: opts.model } : {}),
        instructions: 'Summarize the note in one short sentence.',
        input: text,
      });
    return response.outputText;
  }
}
