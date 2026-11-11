// =============================================================================
// Onboarding for the handyman site (issue #42): Setup guide and Get started
// =============================================================================
//
// Six steps for administrators, in the order a fresh deployment needs them,
// and one for content editors. Every fact reads STORED state through a real
// registry or service (never a Doctor probe, never a provider call):
//
//   projects.storageConfigured   the storage slice's resolved config is complete
//   projects.aiCopyReady         AI is on AND an enabled, current model can draft
//                                project copy (the `projects_copy` feature's needs)
//   projects.pushConfigured      an active VAPID key pair exists (push config)
//   projects.buildToken          a live token of a `site_content:read` user exists, used or not
//   projects.publishedCount      published projects of the caller's organization
//   projects.backupScheduled     the database backup policy is enabled
//   projects.ownProjectCount     projects the caller created
//
// The platform's own storage, AI, push and backup steps cover the same ground
// by Doctor probe, so the manifest replaces them with these (same links, the
// issue's wording, facts that flip with the stored state). Step and fact ids
// are permanent: a step id is stored in a user's `skipped` list.
// =============================================================================

import type { OnboardingFactDef, OnboardingStepDef } from '@marinoscar/platform-api/onboarding';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PROJECTS_COPY_FEATURE } from '../platform/ai/projects-copy.feature';
import { PrismaService } from '../prisma/prisma.service';
import { readModelFacts, type ModelFacts } from './doctor/projects.doctor-checks';

export const PROJECTS_ONBOARDING_FACTS = {
  STORAGE: 'projects.storageConfigured',
  AI_COPY: 'projects.aiCopyReady',
  PUSH: 'projects.pushConfigured',
  BUILD_TOKEN: 'projects.buildToken',
  PUBLISHED: 'projects.publishedCount',
  BACKUP: 'projects.backupScheduled',
  OWN_PROJECTS: 'projects.ownProjectCount',
} as const;

export const PROJECTS_ONBOARDING_STEP_IDS = {
  STORAGE: 'projects.storage',
  OPENAI: 'projects.openai',
  PUSH: 'projects.push',
  BUILD_TOKEN: 'projects.build-token',
  FIRST_PUBLISH: 'projects.first-publish',
  BACKUP: 'projects.backup',
  FIRST_PROJECT: 'projects.first-project',
} as const;

/** The platform steps these replace (the manifest does not register them). */
export const REPLACED_PLATFORM_STEP_IDS: readonly string[] = ['admin.storage', 'admin.ai', 'admin.push', 'admin.backup'];

export interface AiCopyReadyFact {
  aiEnabled: boolean;
  copyModels: number;
}

export interface BuildTokenFact {
  /** Live (not revoked, not expired) tokens of users who hold `site_content:read`. */
  count: number;
  /** Whether any of them has been used. */
  used: boolean;
}

/** How many models can serve the `projects_copy` feature: its needs and input modalities, from the feature's own definition. */
export function countCopyModels(models: readonly ModelFacts[]): number {
  return models.filter(
    (model) =>
      PROJECTS_COPY_FEATURE.needs.every((need) => model.capabilities.includes(need)) &&
      (PROJECTS_COPY_FEATURE.inputModalities ?? []).every((modality) => model.inputModalities.includes(modality)),
  ).length;
}

const activeOrg = (caller: { activeOrgId: string | null }): string => {
  if (!caller.activeOrgId) throw new Error('the credential carries no active organization');
  return caller.activeOrgId;
};

export const PROJECTS_ONBOARDING_FACT_DEFS: readonly OnboardingFactDef[] = [
  {
    id: PROJECTS_ONBOARDING_FACTS.STORAGE,
    resolve: async (ctx) => {
      // Required lazily: the storage slice may not be mounted (the step is then not registered).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { StorageConfigService } = require('@marinoscar/platform-api/storage') as typeof import('@marinoscar/platform-api/storage');
      return (await ctx.get(StorageConfigService).resolve()).configured === true;
    },
  },
  {
    id: PROJECTS_ONBOARDING_FACTS.AI_COPY,
    resolve: async (ctx): Promise<AiCopyReadyFact> => {
      const aiEnabled = await ctx.isFeatureEnabled('ai');
      if (!aiEnabled) return { aiEnabled: false, copyModels: 0 };
      // The platform's model discovery, as stored: enabled, not deprecated.
      const rows = await ctx.get(PrismaService).aiModel.findMany({ where: { enabled: true, deprecatedAt: null }, select: { capabilities: true } });
      return { aiEnabled, copyModels: countCopyModels(rows.map((row) => readModelFacts(row.capabilities))) };
    },
  },
  {
    id: PROJECTS_ONBOARDING_FACTS.PUSH,
    resolve: async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PushConfigService } = require('@marinoscar/platform-api/notifications') as typeof import('@marinoscar/platform-api/notifications');
      return (await ctx.get(PushConfigService).resolveActiveVapidConfig()) !== null;
    },
  },
  {
    id: PROJECTS_ONBOARDING_FACTS.BUILD_TOKEN,
    resolve: async (ctx): Promise<BuildTokenFact> => {
      const orgId = activeOrg(ctx.caller);
      const tokens = await ctx.get(PrismaService).personalAccessToken.findMany({
        where: {
          revokedAt: null,
          expiresAt: { gt: new Date() },
          orgId,
          user: { isActive: true, memberships: { some: { orgId, status: 'active', role: { rolePermissions: { some: { permission: { name: 'site_content:read' } } } } } } },
        },
        select: { lastUsedAt: true },
      });
      return { count: tokens.length, used: tokens.some((token) => token.lastUsedAt !== null) };
    },
  },
  {
    id: PROJECTS_ONBOARDING_FACTS.PUBLISHED,
    resolve: (ctx) => {
      const orgId = activeOrg(ctx.caller);
      return ctx.get(PrismaService).runInOrg(orgId, (tx) => tx.project.count({ where: { orgId, status: 'published' } }));
    },
  },
  {
    id: PROJECTS_ONBOARDING_FACTS.BACKUP,
    resolve: async (ctx) => (await ctx.get(SystemSettingsService).getDatabaseBackupPolicy()).enabled === true,
  },
  {
    id: PROJECTS_ONBOARDING_FACTS.OWN_PROJECTS,
    resolve: (ctx) => {
      const orgId = activeOrg(ctx.caller);
      return ctx.get(PrismaService).runInOrg(orgId, (tx) => tx.project.count({ where: { orgId, createdById: ctx.caller.id } }));
    },
  },
];

const F = PROJECTS_ONBOARDING_FACTS;

export const PROJECTS_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  {
    id: PROJECTS_ONBOARDING_STEP_IDS.STORAGE,
    audience: 'admin',
    tier: 'required',
    order: 10,
    title: 'Connect photo storage',
    description: 'Project photos, their renditions and backups are kept in an object store.',
    actionLabel: 'Configure storage',
    href: '/admin/settings/storage',
    permission: 'storage_config:read',
    skippable: false,
    facts: [F.STORAGE],
    evaluate: (facts) => ({ status: facts[F.STORAGE] === true ? 'done' : 'todo' }),
  },
  {
    id: PROJECTS_ONBOARDING_STEP_IDS.OPENAI,
    audience: 'admin',
    tier: 'recommended',
    order: 40,
    title: 'Connect OpenAI',
    description: 'Turn on AI and enable a model, so project drafts and photo retouching work.',
    actionLabel: 'Configure AI',
    href: '/admin/settings/ai',
    permission: 'ai_config:read',
    skippable: true,
    facts: [F.AI_COPY],
    evaluate: (facts) => {
      const fact = facts[F.AI_COPY] as AiCopyReadyFact;
      if (fact.aiEnabled && fact.copyModels > 0) return { status: 'done' };
      return { status: 'todo', detail: fact.aiEnabled ? 'AI is on, but no enabled model can draft project copy (it needs image input and structured output).' : 'AI is switched off.' };
    },
  },
  {
    id: PROJECTS_ONBOARDING_STEP_IDS.PUSH,
    audience: 'admin',
    tier: 'recommended',
    order: 50,
    title: 'Turn on push notifications',
    description: 'Editors on a phone are told when photos, drafts and site builds are ready.',
    actionLabel: 'Configure Web Push',
    href: '/admin/settings/push',
    permission: 'push:read',
    skippable: true,
    facts: [F.PUSH],
    evaluate: (facts) => ({ status: facts[F.PUSH] === true ? 'done' : 'todo' }),
  },
  {
    id: PROJECTS_ONBOARDING_STEP_IDS.BUILD_TOKEN,
    audience: 'admin',
    tier: 'required',
    order: 55,
    title: 'Create the website build token',
    description: 'The site build reads published projects with a token that can only read site content.',
    actionLabel: 'Open Site publishing',
    href: '/admin/settings/site-publishing',
    permission: 'projects:publish',
    skippable: false,
    facts: [F.BUILD_TOKEN],
    evaluate: (facts) => {
      const fact = facts[F.BUILD_TOKEN] as BuildTokenFact;
      if (fact.count === 0) return { status: 'todo' };
      return fact.used ? { status: 'done' } : { status: 'done', detail: 'The token exists but the build has not used it yet.' };
    },
  },
  {
    id: PROJECTS_ONBOARDING_STEP_IDS.FIRST_PUBLISH,
    audience: 'admin',
    tier: 'recommended',
    order: 58,
    title: 'Publish your first project',
    description: 'Add a project with photos and publish it: it appears on the website at the next build.',
    actionLabel: 'Open projects',
    href: '/projects',
    permission: 'projects:publish',
    skippable: true,
    facts: [F.PUBLISHED],
    evaluate: (facts) => ({ status: (facts[F.PUBLISHED] as number) > 0 ? 'done' : 'todo' }),
  },
  {
    id: PROJECTS_ONBOARDING_STEP_IDS.BACKUP,
    audience: 'admin',
    tier: 'recommended',
    order: 60,
    title: 'Schedule database backups',
    description: 'The portfolio is a business asset: schedule backups, and give the photo bucket its own versioning.',
    actionLabel: 'Configure backups',
    href: '/admin/settings/db-backup',
    permission: 'db_backup:read',
    skippable: true,
    facts: [F.BACKUP],
    evaluate: (facts) => ({ status: facts[F.BACKUP] === true ? 'done' : 'todo' }),
  },
  {
    id: PROJECTS_ONBOARDING_STEP_IDS.FIRST_PROJECT,
    audience: 'user',
    tier: 'recommended',
    order: 6,
    title: 'Add your first project',
    description: 'Pick the service and town, add before and after photos, review the suggested text, then publish.',
    actionLabel: 'Add a project',
    href: '/projects',
    permission: 'projects:write',
    skippable: true,
    facts: [F.OWN_PROJECTS],
    evaluate: (facts) => ({ status: (facts[F.OWN_PROJECTS] as number) > 0 ? 'done' : 'todo' }),
  },
];
