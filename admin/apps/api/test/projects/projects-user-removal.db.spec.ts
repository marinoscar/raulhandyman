// Removing an editor keeps the portfolio (issue #43): the projects and photos
// stay, and the author columns read as removed (null), against real PostgreSQL.
import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';

import { createApp } from '../../src/main';
import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const run = `${Date.now()}`;
let app: NestFastifyApplication;
let prisma: PrismaService;
let system: PrismaSystemService;
let org: string;
let editor: string;

beforeAll(async () => {
  Logger.overrideLogger(false);
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  prisma = app.get(PrismaService);
  system = app.get(PrismaSystemService);
  org = (await system.runAsSystem('purge', (tx) => tx.organization.create({ data: { name: 'Org Gamma', slug: `projects-gamma-${run}` } }))).id;
  editor = (await system.runAsSystem('purge', (tx) => tx.user.create({ data: { email: `person-b-${run}@example.test` } }))).id;
});

afterAll(async () => {
  await system?.runAsSystem('purge', async (tx) => {
    await tx.organization.deleteMany({ where: { id: org } });
    await tx.user.deleteMany({ where: { id: editor } });
  });
  await app?.close();
});

describe('removing an editor', () => {
  it('keeps their projects and photos, with the author shown as removed', async () => {
    const projectId = await prisma.runInOrg(org, async (tx) => {
      const project = await tx.project.create({
        data: { orgId: org, slug: `kept-${run}`, serviceSlug: 'drywall-repair', townSlug: 'conroe', title: 'Kept project', createdById: editor, updatedById: editor },
      });
      await tx.projectPhoto.create({ data: { orgId: org, projectId: project.id, role: 'after', originalObjectId: randomUUID(), createdById: editor } });
      return project.id;
    });

    await system.runAsSystem('purge', (tx) => tx.user.deleteMany({ where: { id: editor } }));

    const after = await prisma.runInOrg(org, async (tx) => ({
      project: await tx.project.findFirst({ where: { id: projectId }, include: { photos: true } }),
    }));
    expect(after.project).not.toBeNull();
    expect(after.project).toMatchObject({ title: 'Kept project', createdById: null, updatedById: null });
    expect(after.project!.photos).toHaveLength(1);
    expect(after.project!.photos[0]!.createdById).toBeNull();
  });
});
