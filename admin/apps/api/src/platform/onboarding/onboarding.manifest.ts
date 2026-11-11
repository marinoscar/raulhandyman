// =============================================================================
// The onboarding manifest: the facts and steps this app has
// =============================================================================
//
// Registered at import time by `./onboarding.slice.ts`, before bootstrap. A
// FACT is the only thing that may read anything (the database, the Doctor, a
// feature switch) and is resolved at most once per request, only when a step
// that applies needs it; a STEP is data plus two synchronous functions over
// facts. A step id is permanent (it is stored in a user's `skipped` list).
//
// The platform ships nine steps; this app keeps the ones whose page exists in
// the slices it mounts (a step that links to `/admin/settings/storage` makes no
// sense without the storage slice), then adds its own.
// =============================================================================

import {
  ONBOARDING_STEP_IDS,
  PLATFORM_ONBOARDING_FACTS,
  PLATFORM_ONBOARDING_STEPS,
  registerOnboardingFact,
  registerOnboardingStep,
  type OnboardingFactDef,
  type OnboardingStepDef,
} from '@marinoscar/platform-api/onboarding';

import { PrismaService } from '../../prisma/prisma.service';
import type { EnabledSlices, SliceId } from '../slices/slice';

/** The slice whose page a platform step links to; a step not listed is always kept. */
const STEP_OWNER: Readonly<Record<string, SliceId>> = {
  [ONBOARDING_STEP_IDS.STORAGE]: 'storage',
  [ONBOARDING_STEP_IDS.EMAIL]: 'email',
  [ONBOARDING_STEP_IDS.AI]: 'ai',
  [ONBOARDING_STEP_IDS.PUSH]: 'notifications',
  [ONBOARDING_STEP_IDS.BACKUP]: 'db-backup',
  // The profile page (name and picture) ships with the storage slice's web side.
  [ONBOARDING_STEP_IDS.PROFILE]: 'storage',
  [ONBOARDING_STEP_IDS.NOTIFICATIONS]: 'notifications',
};

/** The minimal example of an app fact: how many notes the caller has. */
export const NOTE_COUNT_FACT = 'notes.noteCount';

export const APP_ONBOARDING_FACTS: readonly OnboardingFactDef[] = [
  {
    id: NOTE_COUNT_FACT,
    resolve: (ctx) => ctx.get(PrismaService).note.count({ where: { userId: ctx.caller.id } }),
  },
];

/** The minimal example of an app step: write the first note. */
export const APP_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  {
    id: 'notes.first-note',
    audience: 'user',
    tier: 'recommended',
    order: 5,
    title: 'Write your first note',
    description: 'Notes are private to you: start one and it shows up here as done.',
    actionLabel: 'Open notes',
    href: '/notes',
    permission: 'notes:read',
    skippable: true,
    facts: [NOTE_COUNT_FACT],
    evaluate: (facts) => ({ status: (facts[NOTE_COUNT_FACT] as number) > 0 ? 'done' : 'todo' }),
  },
];

/** Registers the platform's facts and the steps that fit `enabled`, then the app's. */
export function registerOnboardingManifest(enabled: EnabledSlices): void {
  registerOnboardingFact(...PLATFORM_ONBOARDING_FACTS);
  registerOnboardingStep(...PLATFORM_ONBOARDING_STEPS.filter((step) => {
    const owner = STEP_OWNER[step.id];
    return owner === undefined || enabled.has(owner);
  }));
  registerOnboardingFact(...APP_ONBOARDING_FACTS);
  registerOnboardingStep(...APP_ONBOARDING_STEPS);
}
