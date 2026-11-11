// The data resets are wired with manifest entries only (issue #880): the
// composed app resolves the user-data slice, plans the delete order from this
// app's schema, includes `Note` (the one decision in
// src/platform/user-data/user-data.manifest.ts) and the Doctor check passes.

import { Test } from '@nestjs/testing';
import { userOwnedModelRegistry } from '@marinoscar/platform-api/core';
import { UserDataPlanService, UserDataRegistriesDoctorCheck } from '@marinoscar/platform-api/user-data';

import { AppModule } from '../src/app.module';

describe('the user-data slice in this app', () => {
  it('plans the purge of a user from the app\'s own schema, Note included', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const plan = moduleRef.get(UserDataPlanService).user();

    expect(plan.steps.map((step) => step.model)).toContain('Note');
    await moduleRef.close();
  });

  it('passes the registries check: every owner model has a decision', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const outcome = await moduleRef.get(UserDataRegistriesDoctorCheck).run();

    expect(outcome).toMatchObject({ status: 'pass' });
    await moduleRef.close();
  });

  it('keeps the projects and their photos when an editor is reset or removed (issue #43)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const plan = moduleRef.get(UserDataPlanService).user();
    const purged = plan.steps.map((step) => step.model);

    // A data reset never deletes organization content: no purge step for either model.
    expect(purged).not.toContain('Project');
    expect(purged).not.toContain('ProjectPhoto');
    // The decision is "detach" (the author fields are only recorded) and they are not part of a person's own export.
    expect(userOwnedModelRegistry.get('Project')).toMatchObject({ purge: 'detach', export: 'exclude', actorFields: ['createdById', 'updatedById'] });
    expect(userOwnedModelRegistry.get('ProjectPhoto')).toMatchObject({ purge: 'detach', export: 'exclude', actorFields: ['createdById'] });
    // The SetNull behaviour itself is proved against PostgreSQL in test/projects/projects-user-removal.db.spec.ts.
    await moduleRef.close();
  });
});
