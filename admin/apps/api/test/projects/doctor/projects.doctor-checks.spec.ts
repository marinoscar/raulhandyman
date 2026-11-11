// The projects Doctor checks (issue #41): every decision through pass, warn and
// fail, and each check against the platform's read-only conformance kit (a
// recording Prisma client that refuses writes, a write-failing storage).
import { describeDoctorCheckConformance } from '@marinoscar/platform-api/doctor/testing';

import {
  AiProjectsReadyDoctorCheck,
  decideAiReady,
  decideBuildFreshness,
  decideContentToken,
  decideIndexNow,
  decideMediaIntegrity,
  missingRenditions,
  ProjectsMediaIntegrityDoctorCheck,
  readModelFacts,
  SiteBuildFreshnessDoctorCheck,
  SiteContentTokenDoctorCheck,
  SiteIndexNowDoctorCheck,
  worst,
} from '../../../src/projects/doctor/projects.doctor-checks';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms);
const ahead = (ms: number) => new Date(NOW + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('site.content_token decision', () => {
  const token = (over: Partial<{ expiresAt: Date; createdAt: Date; lastUsedAt: Date | null }> = {}) => ({ expiresAt: ahead(90 * DAY), createdAt: ago(30 * DAY), lastUsedAt: ago(3 * MIN), ...over });

  it('passes: used within 10 minutes and not expiring soon', () => {
    expect(decideContentToken([token()], NOW).status).toBe('pass');
  });
  it('warns: expiring within 14 days, or unused for 10 minutes to 24 hours', () => {
    expect(decideContentToken([token({ expiresAt: ahead(5 * DAY) })], NOW).status).toBe('warn');
    expect(decideContentToken([token({ lastUsedAt: ago(2 * HOUR) })], NOW).status).toBe('warn');
    expect(decideContentToken([token({ lastUsedAt: null, createdAt: ago(2 * HOUR) })], NOW).status).toBe('warn');
  });
  it('fails: no token, only expired tokens, or unused for over 24 hours', () => {
    expect(decideContentToken([], NOW)).toMatchObject({ status: 'fail', remedy: expect.any(String) });
    expect(decideContentToken([token({ expiresAt: ago(DAY) })], NOW).status).toBe('fail');
    expect(decideContentToken([token({ lastUsedAt: ago(3 * DAY) })], NOW).status).toBe('fail');
    expect(decideContentToken([token({ lastUsedAt: null })], NOW).status).toBe('fail');
  });
  it('judges the most recently used live token, and carries no secret', () => {
    const out = decideContentToken([token({ lastUsedAt: ago(10 * DAY) }), token({ lastUsedAt: ago(MIN) })], NOW);
    expect(out.status).toBe('pass');
    expect(JSON.stringify(out)).not.toMatch(/pat_|hash|prefix/i);
  });
});

describe('site.build_freshness decision', () => {
  const base = { contentVersion: 'v2', lastPublishedAt: ago(0), lastBuildVersion: 'v1', lastBuildStatus: 'live', lastBuildError: null };
  it('passes when the built version is the published one, and for a fresh pending build', () => {
    expect(decideBuildFreshness({ ...base, lastBuildVersion: 'v2' }, NOW).status).toBe('pass');
    expect(decideBuildFreshness({ ...base, lastPublishedAt: ago(2 * MIN) }, NOW).status).toBe('pass');
  });
  it('warns for a mismatch of 5 to 15 minutes', () => {
    expect(decideBuildFreshness({ ...base, lastPublishedAt: ago(5 * MIN) }, NOW).status).toBe('warn');
    expect(decideBuildFreshness({ ...base, lastPublishedAt: ago(15 * MIN) }, NOW).status).toBe('warn');
  });
  it('fails for a mismatch over 15 minutes, and shows the error of a failed build', () => {
    expect(decideBuildFreshness({ ...base, lastPublishedAt: ago(16 * MIN) }, NOW).status).toBe('fail');
    const failed = decideBuildFreshness({ ...base, lastBuildVersion: 'v2', lastBuildStatus: 'failed', lastBuildError: 'astro build exited 1' }, NOW);
    expect(failed.status).toBe('fail');
    expect(failed.detail).toContain('astro build exited 1');
  });
});

describe('projects.media_integrity decision', () => {
  const ok = { card4x3: { objectId: 'c' }, hero16x9: { objectId: 'h' }, ogBranded: { objectId: 'o' } };
  it('finds the photos missing a master, a crop or (the cover) the branded OG', () => {
    const photos = [
      { id: 'p1', isCover: true, masterObjectId: 'm', renditions: ok },
      { id: 'p2', isCover: false, masterObjectId: 'm', renditions: { card4x3: { objectId: 'c' } } },
      { id: 'p3', isCover: true, masterObjectId: 'm', renditions: { card4x3: { objectId: 'c' }, hero16x9: { objectId: 'h' } } },
      { id: 'p4', isCover: false, masterObjectId: null, renditions: ok },
      { id: 'p5', isCover: false, masterObjectId: 'm', renditions: null },
      { id: 'p6', isCover: false, masterObjectId: 'm', renditions: { card4x3: { objectId: 'c' }, hero16x9: { objectId: 'h' } } },
    ];
    expect(missingRenditions(photos)).toEqual(['p2', 'p3', 'p4', 'p5']);
  });
  it('also reports a photo whose storage object row is not ready', () => {
    const photos = [{ id: 'p1', isCover: false, masterObjectId: 'm', renditions: ok }];
    expect(missingRenditions(photos, new Set(['m', 'c', 'h']))).toEqual([]);
    expect(missingRenditions(photos, new Set(['m', 'c']))).toEqual(['p1']);
  });
  it('skips with no photos, passes when none is missing, fails listing up to 10 ids', () => {
    expect(decideMediaIntegrity(0, []).status).toBe('skip');
    expect(decideMediaIntegrity(4, []).status).toBe('pass');
    const ids = Array.from({ length: 12 }, (_, i) => `photo-${i}`);
    const out = decideMediaIntegrity(20, ids);
    expect(out.status).toBe('fail');
    expect(out.detail).toContain('photo-9');
    expect(out.detail).not.toContain('photo-10');
  });
});

describe('ai.projects_ready decision', () => {
  const copy = { capabilities: ['responses', 'structured_output'], inputModalities: ['text', 'image'] };
  const edit = { capabilities: ['image_edit'], inputModalities: ['image'] };
  it('fails when AI is off or no model can draft copy', () => {
    expect(decideAiReady(false, [copy, edit]).status).toBe('fail');
    expect(decideAiReady(true, [edit]).status).toBe('fail');
    expect(decideAiReady(true, [{ capabilities: ['responses', 'structured_output'], inputModalities: ['text'] }]).status).toBe('fail');
  });
  it('warns without an image-edit model, passes with both', () => {
    expect(decideAiReady(true, [copy]).status).toBe('warn');
    expect(decideAiReady(true, [copy, edit]).status).toBe('pass');
  });
  it('reads a stored capability record defensively', () => {
    expect(readModelFacts({ capabilities: ['responses', 3], inputModalities: ['image'] })).toEqual({ capabilities: ['responses'], inputModalities: ['image'] });
    expect(readModelFacts(null)).toEqual({ capabilities: [], inputModalities: [] });
  });
});

describe('site.indexnow decision', () => {
  it('warns with no key, fails when the last ping was refused, passes otherwise', () => {
    expect(decideIndexNow({ keyConfigured: false, lastPingStatus: null, lastPingError: null }).status).toBe('warn');
    expect(decideIndexNow({ keyConfigured: true, lastPingStatus: 'config_error', lastPingError: 'IndexNow rejected the key (HTTP 403)' })).toMatchObject({ status: 'fail', detail: expect.stringContaining('403') });
    expect(decideIndexNow({ keyConfigured: true, lastPingStatus: 'retrying', lastPingError: null }).status).toBe('warn');
    expect(decideIndexNow({ keyConfigured: true, lastPingStatus: 'ok', lastPingError: null }).status).toBe('pass');
    expect(decideIndexNow({ keyConfigured: true, lastPingStatus: null, lastPingError: null }).status).toBe('pass');
  });
});

describe('worst', () => {
  it('ranks fail over warn over pass over skip', () => {
    const pick = (...statuses: Array<'pass' | 'warn' | 'fail' | 'skip'>) => worst(statuses.map((status) => ({ status, detail: status }))).status;
    expect(pick('pass', 'fail', 'warn')).toBe('fail');
    expect(pick('pass', 'warn')).toBe('warn');
    expect(pick('skip', 'pass')).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// The platform's conformance kit, once per check: identity, timeout, outcome
// shape, read-only against a recording client, no secret in the outcome.
// ---------------------------------------------------------------------------

const registry = { register: jest.fn() } as never;
const systemOver = (client: any) => ({ runAsSystem: (_reason: string, fn: (tx: unknown) => Promise<unknown>) => fn(client) }) as never;
const stateRow = { contentVersion: 'v2', lastPublishedAt: new Date(Date.now() - 20 * MIN), lastBuildVersion: 'v1', lastBuildStatus: 'live', lastBuildError: null, lastPingStatus: 'config_error', lastPingError: 'IndexNow rejected the key (HTTP 403)' };

describeDoctorCheckConformance('site.content_token', ({ prisma }) => new SiteContentTokenDoctorCheck(registry, systemOver(prisma.client)), {
  scenarios: [
    { name: 'no token', prisma: { results: { 'personalAccessToken.findMany': [] } }, expectStatus: 'fail' },
    {
      name: 'a used token',
      prisma: { results: { 'personalAccessToken.findMany': [{ expiresAt: new Date(Date.now() + 90 * DAY), createdAt: new Date(Date.now() - DAY), lastUsedAt: new Date() }] } },
      expectStatus: 'pass',
      secrets: ['pat_secret_value'],
    },
  ],
});

describeDoctorCheckConformance('site.build_freshness', ({ prisma }) => new SiteBuildFreshnessDoctorCheck(registry, systemOver(prisma.client)), {
  scenarios: [
    { name: 'nothing published', prisma: { results: { 'sitePublishState.findMany': [] } }, expectStatus: 'skip' },
    { name: 'a stale build', prisma: { results: { 'sitePublishState.findMany': [stateRow] } }, expectStatus: 'fail' },
  ],
});

describeDoctorCheckConformance('projects.media_integrity', ({ prisma }) => new ProjectsMediaIntegrityDoctorCheck(registry, systemOver(prisma.client)), {
  scenarios: [
    { name: 'no published project', prisma: { results: { 'project.findMany': [] } }, expectStatus: 'skip' },
    {
      name: 'a photo without renditions',
      prisma: { results: { 'project.findMany': [{ coverPhotoId: 'p1', photos: [{ id: 'p1', chosenVariant: 'enhanced', originalObjectId: 'o', enhancedObjectId: 'e', retouchedObjectId: null, renditions: null }] }], 'storageObject.findMany': [] } },
      expectStatus: 'fail',
    },
  ],
});

describeDoctorCheckConformance('ai.projects_ready', ({ prisma }) => new AiProjectsReadyDoctorCheck(registry, systemOver(prisma.client), { getNamespace: async () => ({ enabled: true }) } as never), {
  scenarios: [
    { name: 'no models', prisma: { results: { 'aiModel.findMany': [] } }, expectStatus: 'fail' },
    {
      name: 'both models',
      prisma: { results: { 'aiModel.findMany': [{ capabilities: { capabilities: ['responses', 'structured_output'], inputModalities: ['image'] } }, { capabilities: { capabilities: ['image_edit'], inputModalities: ['image'] } }] } },
      expectStatus: 'pass',
    },
  ],
});

describeDoctorCheckConformance(
  'site.indexnow',
  ({ prisma }) => new SiteIndexNowDoctorCheck(registry, systemOver(prisma.client), { describe: async () => ({ updatedAt: new Date() }) } as never),
  { scenarios: [{ name: 'a refused ping', prisma: { results: { 'sitePublishState.findMany': [stateRow] } }, expectStatus: 'fail', secrets: ['0123456789abcdef0123456789abcdef'] }] },
);
