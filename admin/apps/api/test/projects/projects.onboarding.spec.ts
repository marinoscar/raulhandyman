// The handyman site's onboarding steps (issue #42): every fact is derived from
// stored state and flips as the fixtures change; each step turns todo to done
// from its fact; the manifest replaces the platform's four overlapping steps.
import { PushConfigService } from '@marinoscar/platform-api/notifications';
import { StorageConfigService } from '@marinoscar/platform-api/storage';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import {
  countCopyModels,
  PROJECTS_ONBOARDING_FACT_DEFS,
  PROJECTS_ONBOARDING_FACTS as F,
  PROJECTS_ONBOARDING_STEPS,
} from '../../src/projects/projects.onboarding';

const ORG = '11111111-1111-4111-8111-111111111111';
const copyModel = { capabilities: { capabilities: ['responses', 'structured_output'], inputModalities: ['text', 'image'] } };

interface World {
  storageConfigured: boolean;
  aiEnabled: boolean;
  models: unknown[];
  vapid: boolean;
  tokens: Array<{ lastUsedAt: Date | null }>;
  published: number;
  ownProjects: number;
  backupEnabled: boolean;
  activeOrgId: string | null;
}

const world = (over: Partial<World> = {}): World => ({ storageConfigured: false, aiEnabled: false, models: [], vapid: false, tokens: [], published: 0, ownProjects: 0, backupEnabled: false, activeOrgId: ORG, ...over });

/** An onboarding request context over the fixture world: `get(token)` hands back fakes by class name. */
function contextFor(w: World) {
  const prisma = {
    aiModel: { findMany: jest.fn(async () => w.models) },
    personalAccessToken: { findMany: jest.fn(async () => w.tokens) },
    runInOrg: jest.fn(async (_org: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ project: { count: jest.fn(async ({ where }: { where: { status?: string; createdById?: string } }) => (where.createdById ? w.ownProjects : w.published)) } }),
    ),
  };
  const services = new Map<unknown, unknown>([
    [PrismaService, prisma],
    [SystemSettingsService, { getDatabaseBackupPolicy: async () => ({ enabled: w.backupEnabled }) }],
    [StorageConfigService, { resolve: async () => ({ configured: w.storageConfigured }) }],
    [PushConfigService, { resolveActiveVapidConfig: async () => (w.vapid ? { publicKey: 'k' } : null) }],
  ]);
  return {
    prisma,
    ctx: {
      caller: { id: 'user-1', permissions: [], roles: [], activeOrgId: w.activeOrgId },
      isFeatureEnabled: async () => w.aiEnabled,
      get: (token: unknown) => {
        const found = services.get(token);
        if (!found) throw new Error(`no service for ${String((token as { name?: string })?.name)}`);
        return found;
      },
    } as never,
  };
}

const fact = (id: string) => PROJECTS_ONBOARDING_FACT_DEFS.find((def) => def.id === id)!;
const resolve = (id: string, w: World) => fact(id).resolve(contextFor(w).ctx);
const step = (id: string) => PROJECTS_ONBOARDING_STEPS.find((candidate) => candidate.id === id)!;
const status = (id: string, facts: Record<string, unknown>) => step(id).evaluate!(facts);

describe('the facts flip with the stored state', () => {
  it('storage: configured or not', async () => {
    expect(await resolve(F.STORAGE, world())).toBe(false);
    expect(await resolve(F.STORAGE, world({ storageConfigured: true }))).toBe(true);
  });

  it('AI: off, on without a usable model, on with one for projects_copy', async () => {
    expect(await resolve(F.AI_COPY, world())).toEqual({ aiEnabled: false, copyModels: 0 });
    expect(await resolve(F.AI_COPY, world({ aiEnabled: true }))).toEqual({ aiEnabled: true, copyModels: 0 });
    const onlyEdit = { capabilities: { capabilities: ['image_edit'], inputModalities: ['image'] } };
    expect(await resolve(F.AI_COPY, world({ aiEnabled: true, models: [onlyEdit] }))).toEqual({ aiEnabled: true, copyModels: 0 });
    expect(await resolve(F.AI_COPY, world({ aiEnabled: true, models: [onlyEdit, copyModel] }))).toEqual({ aiEnabled: true, copyModels: 1 });
  });

  it('push: a VAPID key pair is active or not', async () => {
    expect(await resolve(F.PUSH, world())).toBe(false);
    expect(await resolve(F.PUSH, world({ vapid: true }))).toBe(true);
  });

  it('build token: none, one unused, one used; and it needs an active organization', async () => {
    expect(await resolve(F.BUILD_TOKEN, world())).toEqual({ count: 0, used: false });
    expect(await resolve(F.BUILD_TOKEN, world({ tokens: [{ lastUsedAt: null }] }))).toEqual({ count: 1, used: false });
    expect(await resolve(F.BUILD_TOKEN, world({ tokens: [{ lastUsedAt: null }, { lastUsedAt: new Date() }] }))).toEqual({ count: 2, used: true });
    await expect(resolve(F.BUILD_TOKEN, world({ activeOrgId: null }))).rejects.toThrow(/active organization/);
  });

  it('published projects, the caller\'s own projects and the backup schedule', async () => {
    expect(await resolve(F.PUBLISHED, world())).toBe(0);
    expect(await resolve(F.PUBLISHED, world({ published: 3 }))).toBe(3);
    expect(await resolve(F.OWN_PROJECTS, world({ ownProjects: 2 }))).toBe(2);
    expect(await resolve(F.BACKUP, world())).toBe(false);
    expect(await resolve(F.BACKUP, world({ backupEnabled: true }))).toBe(true);
  });

  it('reads the build token only for the active organization and only the site_content:read holders', async () => {
    const { ctx, prisma } = contextFor(world({ tokens: [] }));
    await fact(F.BUILD_TOKEN).resolve(ctx);
    const where = (prisma.personalAccessToken.findMany.mock.calls as unknown as Array<[{ where: object }]>)[0]![0].where;
    expect(where).toMatchObject({ revokedAt: null, orgId: ORG });
    expect(JSON.stringify(where)).toContain('site_content:read');
  });
});

describe('the steps', () => {
  it('are the six admin steps in the issue order, then the content editor step', () => {
    const admin = PROJECTS_ONBOARDING_STEPS.filter((candidate) => candidate.audience === 'admin').sort((a, b) => a.order - b.order);
    expect(admin.map((candidate) => candidate.id)).toEqual(['projects.storage', 'projects.openai', 'projects.push', 'projects.build-token', 'projects.first-publish', 'projects.backup']);
    expect(admin.map((candidate) => candidate.href)).toEqual(['/admin/settings/storage', '/admin/settings/ai', '/admin/settings/push', '/admin/settings/site-publishing', '/projects', '/admin/settings/db-backup']);
    const editor = PROJECTS_ONBOARDING_STEPS.filter((candidate) => candidate.audience === 'user');
    expect(editor).toHaveLength(1);
    expect(editor[0]).toMatchObject({ id: 'projects.first-project', title: 'Add your first project', permission: 'projects:write' });
  });

  it('turn from todo to done as the facts change', () => {
    expect(status('projects.storage', { [F.STORAGE]: false }).status).toBe('todo');
    expect(status('projects.storage', { [F.STORAGE]: true }).status).toBe('done');

    expect(status('projects.openai', { [F.AI_COPY]: { aiEnabled: false, copyModels: 0 } })).toMatchObject({ status: 'todo' });
    expect(status('projects.openai', { [F.AI_COPY]: { aiEnabled: true, copyModels: 0 } }).detail).toMatch(/no enabled model/);
    expect(status('projects.openai', { [F.AI_COPY]: { aiEnabled: true, copyModels: 2 } }).status).toBe('done');

    expect(status('projects.push', { [F.PUSH]: false }).status).toBe('todo');
    expect(status('projects.push', { [F.PUSH]: true }).status).toBe('done');

    expect(status('projects.build-token', { [F.BUILD_TOKEN]: { count: 0, used: false } }).status).toBe('todo');
    expect(status('projects.build-token', { [F.BUILD_TOKEN]: { count: 1, used: false } })).toMatchObject({ status: 'done', detail: expect.stringContaining('not used') });
    expect(status('projects.build-token', { [F.BUILD_TOKEN]: { count: 1, used: true } })).toEqual({ status: 'done' });

    expect(status('projects.first-publish', { [F.PUBLISHED]: 0 }).status).toBe('todo');
    expect(status('projects.first-publish', { [F.PUBLISHED]: 1 }).status).toBe('done');

    expect(status('projects.backup', { [F.BACKUP]: false }).status).toBe('todo');
    expect(status('projects.backup', { [F.BACKUP]: true }).status).toBe('done');

    expect(status('projects.first-project', { [F.OWN_PROJECTS]: 0 }).status).toBe('todo');
    expect(status('projects.first-project', { [F.OWN_PROJECTS]: 1 }).status).toBe('done');
  });

  it('use the permission strings their pages enforce', () => {
    expect(Object.fromEntries(PROJECTS_ONBOARDING_STEPS.map((candidate) => [candidate.id, candidate.permission]))).toEqual({
      'projects.storage': 'storage_config:read',
      'projects.openai': 'ai_config:read',
      'projects.push': 'push:read',
      'projects.build-token': 'projects:publish',
      'projects.first-publish': 'projects:publish',
      'projects.backup': 'db_backup:read',
      'projects.first-project': 'projects:write',
    });
  });
});

describe('countCopyModels', () => {
  it('counts the models that meet the projects_copy feature\'s needs', () => {
    expect(countCopyModels([])).toBe(0);
    expect(countCopyModels([{ capabilities: ['responses', 'structured_output'], inputModalities: ['text'] }])).toBe(0);
    expect(countCopyModels([{ capabilities: ['responses', 'structured_output'], inputModalities: ['image'] }, { capabilities: ['image_edit'], inputModalities: ['image'] }])).toBe(1);
  });
});
