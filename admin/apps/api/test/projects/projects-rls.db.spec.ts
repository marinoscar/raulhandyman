// Row-level security of the handyman site's org tables against a real,
// migrated PostgreSQL (POSTGRES_USER an ordinary role, so policies are in
// force): a row written under organization A is invisible under organization
// B, a transaction with no `app.org_id` sees nothing, and a write for another
// organization is refused.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../../src/main';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaSystemService } from '../../src/prisma/prisma-system.service';

let app: NestFastifyApplication;
let prisma: PrismaService;
let system: PrismaSystemService;
const run = `${Date.now()}`;
let orgA: string;
let orgB: string;
let projectA: string;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  prisma = app.get(PrismaService);
  system = app.get(PrismaSystemService);
  const a = await system.runAsSystem('purge', (tx) => tx.organization.create({ data: { name: 'Org Alpha', slug: `org-alpha-${run}` } }));
  const b = await system.runAsSystem('purge', (tx) => tx.organization.create({ data: { name: 'Org Beta', slug: `org-beta-${run}` } }));
  orgA = a.id;
  orgB = b.id;
});

afterAll(async () => {
  await system?.runAsSystem('purge', async (tx) => {
    await tx.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  });
  await app?.close();
});

describe('projects, project_photos and site_publish_state row-level security', () => {
  it('writes under org A', async () => {
    await prisma.runInOrg(orgA, async (tx) => {
      const project = await tx.project.create({
        data: { orgId: orgA, slug: 'deck-repair', serviceSlug: 'decks', townSlug: 'town-a', title: 'Deck repair' },
      });
      projectA = project.id;
      await tx.projectPhoto.create({
        data: { orgId: orgA, projectId: project.id, role: 'before', originalObjectId: '00000000-0000-4000-8000-000000000001' },
      });
      await tx.sitePublishState.create({ data: { orgId: orgA, contentVersion: 'v1' } });
    });
    expect(projectA).toBeDefined();
  });

  it('shows the rows to org A', async () => {
    await prisma.runInOrg(orgA, async (tx) => {
      expect(await tx.project.count({ where: { slug: 'deck-repair' } })).toBe(1);
      expect(await tx.projectPhoto.count()).toBe(1);
      expect(await tx.sitePublishState.count()).toBe(1);
    });
  });

  it('hides org A rows from org B', async () => {
    await prisma.runInOrg(orgB, async (tx) => {
      expect(await tx.project.count()).toBe(0);
      expect(await tx.projectPhoto.count()).toBe(0);
      expect(await tx.sitePublishState.count()).toBe(0);
      expect(await tx.project.findUnique({ where: { id: projectA } })).toBeNull();
    });
  });

  it('returns nothing when app.org_id is not set', async () => {
    const counts = await prisma.$transaction(async (tx) => ({
      projects: await tx.project.count(),
      photos: await tx.projectPhoto.count(),
      state: await tx.sitePublishState.count(),
    }));
    expect(counts).toEqual({ projects: 0, photos: 0, state: 0 });
  });

  it('refuses a write for another organization', async () => {
    await expect(
      prisma.runInOrg(orgB, (tx) =>
        tx.project.create({ data: { orgId: orgA, slug: 'sneaky', serviceSlug: 'decks', townSlug: 'town-a' } }),
      ),
    ).rejects.toThrow();
  });

  it('keeps a project when its author is removed (SetNull)', async () => {
    const user = await system.runAsSystem('purge', (tx) =>
      tx.user.create({ data: { email: `editor-${run}@example.test` } }),
    );
    await prisma.runInOrg(orgA, (tx) => tx.project.update({ where: { id: projectA }, data: { createdById: user.id, updatedById: user.id } }));
    await system.runAsSystem('purge', (tx) => tx.user.delete({ where: { id: user.id } }));
    const after = await prisma.runInOrg(orgA, (tx) => tx.project.findUnique({ where: { id: projectA } }));
    expect(after).not.toBeNull();
    expect(after?.createdById).toBeNull();
    expect(after?.updatedById).toBeNull();
  });
});
