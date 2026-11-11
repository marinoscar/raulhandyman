// The db tier, per optional slice: the whole app booted against a real, migrated
// and seeded PostgreSQL with the slices `packages/shared/slices.json` enables.
// For each slice, one route it owns answers an administrator and refuses an
// anonymous caller while the slice is on, and does not exist (404) while it is off,
// so the same spec holds for any combination you configure.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../src/main';
import { SLICE_IDS, type SliceId } from '@app/shared';
import { isSliceEnabled } from '../src/platform/slices/manifest';

interface Probe {
  slice: SliceId;
  url: string;
  /** What an anonymous caller gets while the slice is on (default 401). */
  anonymous?: number;
}

const PROBES: readonly Probe[] = [
  { slice: 'storage', url: '/api/admin/storage-config' },
  { slice: 'email', url: '/api/email-settings' },
  { slice: 'notifications', url: '/api/notifications/events' },
  { slice: 'sharing', url: '/api/groups' },
  { slice: 'ai', url: '/api/admin/ai/config' },
  { slice: 'db-backup', url: '/api/admin/db-backup/config' },
  { slice: 'exports', url: '/api/exports/sources' },
  { slice: 'onboarding', url: '/api/onboarding' },
  { slice: 'android-app', url: '/api/admin/android-app' },
  { slice: 'telemetry', url: '/api/admin/telemetry/config' },
];

let app: NestFastifyApplication;
let admin: string;
const run = `${Date.now()}`;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const res = await app.inject({ method: 'POST', url: '/api/auth/test/login', payload: { email: `slices-${run}@example.test`, role: 'admin' } });
  admin = new URL(String(res.headers.location)).searchParams.get('token') ?? '';
});

afterAll(async () => {
  await app?.close();
});

describe('the optional slices over HTTP', () => {
  it('has a probe for every optional slice that owns routes', () => {
    expect(PROBES.map((probe) => probe.slice).sort()).toEqual(SLICE_IDS.filter((id) => id !== 'credentials').sort());
  });

  it.each(PROBES.map((probe) => [probe.slice, probe]))('%s', async (_slice, probe) => {
    const asAdmin = await app.inject({ method: 'GET', url: probe.url, headers: { authorization: `Bearer ${admin}` } });
    const anonymous = await app.inject({ method: 'GET', url: probe.url });
    if (isSliceEnabled(probe.slice)) {
      expect(asAdmin.statusCode).toBe(200);
      expect(anonymous.statusCode).toBe(probe.anonymous ?? 401);
    } else {
      expect(asAdmin.statusCode).toBe(404);
      expect(anonymous.statusCode).toBe(404);
    }
  });

  it('serves the Android asset links without a session while the Android slice is on', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/well-known/assetlinks.json' });
    expect(res.statusCode).toBe(isSliceEnabled('android-app') ? 200 : 404);
  });
});
