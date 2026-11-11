// The project and site notifications (issue #39): the event registrations, the
// recipients of each, and the payloads (ids, a title, a URL, a short excerpt:
// never work notes or secrets). The publishers run against a fake notifications
// service and a fake organization database.
import { NOTIFICATION_EVENT_KEY_PATTERN } from '@marinoscar/platform-api/notifications';

import { NotifyingAiEventsPublisher, NotifyingPhotoEventsPublisher, NotifyingProjectEventsPublisher, NotifyingSiteEventsPublisher } from '../../../src/projects/events/project-event-publishers';
import { ProjectNotifier } from '../../../src/projects/events/project-notifier';
import { errorExcerpt, PROJECT_NOTIFICATION_EVENTS as EVENTS, PROJECT_NOTIFICATIONS } from '../../../src/projects/projects.notifications';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333';

interface Sent {
  event: string;
  userId: string;
  data: Record<string, unknown>;
  orgId?: string | null;
}

function harness(opts: { holders?: string[]; admins?: string[]; newestPublisher?: string | null } = {}) {
  const sent: Sent[] = [];
  const notifications = {
    notifyNow: jest.fn(async (event: string, userId: string, data: Record<string, unknown>, options?: { orgId?: string | null }) => {
      sent.push({ event, userId, data, orgId: options?.orgId });
      return { rateLimited: false, retryAfterMs: null };
    }),
  };
  const lookups: Array<Record<string, any>> = [];
  const prisma = {
    membership: {
      findMany: jest.fn(async (args: { where: Record<string, any> }) => {
        lookups.push(args.where);
        const rows = args.where.role?.name === 'org_admin' ? (opts.admins ?? []) : (opts.holders ?? []);
        return rows.map((userId) => ({ userId }));
      }),
    },
    runInOrg: jest.fn(async (_org: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ project: { findFirst: jest.fn(async () => (opts.newestPublisher === undefined ? { updatedById: 'user-pub' } : { updatedById: opts.newestPublisher })) } }),
    ),
  };
  const notifier = new ProjectNotifier(prisma as never, notifications as never, { get: () => 'https://app.example.test/' } as never);
  return { sent, notifications, prisma, lookups, notifier };
}

describe('project notification registrations', () => {
  it('declares the six events, each valid for the platform registry', () => {
    expect(PROJECT_NOTIFICATIONS.map((entry) => entry.event.key)).toEqual([
      'projects.photo_ready',
      'projects.ai_ready',
      'projects.retouch_ready',
      'projects.published',
      'site.build_live',
      'site.build_failed',
    ]);
    for (const entry of PROJECT_NOTIFICATIONS) expect(entry.event.key).toMatch(NOTIFICATION_EVENT_KEY_PATTERN);
  });

  it('offers the channels of the issue: push off for photo and published, email only for a failed build', () => {
    const channels = Object.fromEntries(PROJECT_NOTIFICATIONS.map((entry) => [entry.event.key, entry.event.channels]));
    expect(channels['projects.photo_ready']).toEqual(['browser']);
    expect(channels['projects.published']).toEqual(['browser']);
    expect(channels['projects.ai_ready']).toEqual(['browser', 'push']);
    expect(channels['projects.retouch_ready']).toEqual(['browser', 'push']);
    expect(channels['site.build_live']).toEqual(['browser', 'push']);
    expect(channels['site.build_failed']).toEqual(['email', 'browser', 'push']);
    expect(PROJECT_NOTIFICATIONS.find((entry) => entry.event.key === 'site.build_failed')?.emailTemplate).toBe('site-build-failed');
  });

  it('renders a browser notification with a deep link for every event', () => {
    const data: Record<string, unknown> = { projectId: PROJECT, photoId: PHOTO, status: 'ok', title: 'Deck repair', url: 'https://app.example.test/projects/x', error: 'boom', statusUrl: '/admin/settings/site-publishing', contentVersion: 'v1' };
    for (const entry of PROJECT_NOTIFICATIONS) {
      const content = (entry.browserTemplate as unknown as (d: unknown) => { title: string; body: string; link?: string })(data);
      expect(content.title.length).toBeGreaterThan(0);
      expect(content.link).toBeTruthy();
    }
    const photo = PROJECT_NOTIFICATIONS[0]!.browserTemplate as unknown as (d: unknown) => { link?: string; title: string };
    expect(photo(data).link).toBe(`/projects/${PROJECT}`);
    expect(photo({ ...data, status: 'failed' }).title).toMatch(/could not/);
  });
});

describe('errorExcerpt', () => {
  it('keeps one short line and removes token-looking strings', () => {
    const text = errorExcerpt(`step failed\nBearer abc.def.ghi and key ${'a'.repeat(40)} ${'x'.repeat(400)}`);
    expect(text).not.toContain('\n');
    expect(text).not.toContain('abc.def.ghi');
    expect(text).not.toContain('a'.repeat(40));
    expect(text.length).toBeLessThanOrEqual(200);
    expect(errorExcerpt(undefined)).toBe('The site build failed');
  });
});

describe('projects.published', () => {
  it('goes to every projects:publish holder except the actor, once each, with the title and link only', async () => {
    const h = harness({ holders: ['user-a', 'user-b', 'user-actor', 'user-a'] });
    await new NotifyingProjectEventsPublisher(h.notifier).publishPublished({ orgId: ORG, projectId: PROJECT, slug: 'deck-repair', title: 'Deck repair', actorUserId: 'user-actor' });
    expect(h.sent.map((entry) => entry.userId).sort()).toEqual(['user-a', 'user-b']);
    for (const entry of h.sent) {
      expect(entry.event).toBe(EVENTS.PUBLISHED);
      expect(entry.orgId).toBe(ORG);
      expect(entry.data).toEqual({ projectId: PROJECT, title: 'Deck repair', url: `https://app.example.test/projects/${PROJECT}` });
    }
    expect(h.lookups[0]).toMatchObject({ orgId: ORG, status: 'active', role: { rolePermissions: { some: { permission: { name: 'projects:publish' } } } } });
  });

  it('does nothing for an unpublish and when nobody else can publish', async () => {
    const h = harness({ holders: ['user-actor'] });
    const publisher = new NotifyingProjectEventsPublisher(h.notifier);
    await publisher.publishPublished({ orgId: ORG, projectId: PROJECT, slug: 's', title: 't', actorUserId: 'user-actor' });
    await publisher.publishUnpublished({ orgId: ORG, projectId: PROJECT, slug: 's', actorUserId: 'user-actor' });
    expect(h.sent).toEqual([]);
  });
});

describe('AI and photo events', () => {
  it('sends ai_ready and retouch_ready to the requesting user only', async () => {
    const h = harness();
    const ai = new NotifyingAiEventsPublisher(h.notifier);
    await ai.publishSuggestReady({ orgId: ORG, projectId: PROJECT, userId: 'user-req', jobId: 'job-1' });
    await ai.publishRetouchReady({ orgId: ORG, projectId: PROJECT, userId: 'user-req', photoId: PHOTO, jobId: 'job-2' });
    expect(h.sent).toEqual([
      { event: 'projects.ai_ready', userId: 'user-req', orgId: ORG, data: { projectId: PROJECT, status: 'ok' } },
      { event: 'projects.retouch_ready', userId: 'user-req', orgId: ORG, data: { projectId: PROJECT, photoId: PHOTO } },
    ]);
  });

  it('sends photo_ready to the uploader, and to nobody when the uploader is gone', async () => {
    const h = harness();
    const photos = new NotifyingPhotoEventsPublisher(h.notifier);
    await photos.publishPhotoReady({ orgId: ORG, projectId: PROJECT, photoId: PHOTO, uploaderId: 'user-up', status: 'failed' });
    await photos.publishPhotoReady({ orgId: ORG, projectId: PROJECT, photoId: PHOTO, uploaderId: null, status: 'ok' });
    expect(h.sent).toEqual([{ event: 'projects.photo_ready', userId: 'user-up', orgId: ORG, data: { projectId: PROJECT, photoId: PHOTO, status: 'failed' } }]);
  });
});

describe('site build events', () => {
  it('sends build_live to the publisher of the newest change, falling back to the administrators', async () => {
    const h = harness({ admins: ['admin-1'] });
    await new NotifyingSiteEventsPublisher(h.notifier, h.prisma as never).publishBuildLive({ orgId: ORG, contentVersion: 'v9', durationMs: 4000 });
    expect(h.sent).toEqual([
      { event: 'site.build_live', userId: 'user-pub', orgId: ORG, data: { contentVersion: 'v9', url: 'https://app.example.test/admin/settings/site-publishing' } },
    ]);

    const fallback = harness({ admins: ['admin-1'], newestPublisher: null });
    await new NotifyingSiteEventsPublisher(fallback.notifier, fallback.prisma as never).publishBuildLive({ orgId: ORG, contentVersion: 'v9', durationMs: 1 });
    expect(fallback.sent.map((entry) => entry.userId)).toEqual(['admin-1']);
  });

  it('sends build_failed to the org administrators with a short, redacted error excerpt', async () => {
    const h = harness({ admins: ['admin-1', 'admin-2'] });
    await new NotifyingSiteEventsPublisher(h.notifier, h.prisma as never).publishBuildFailed({
      orgId: ORG,
      contentVersion: 'v9',
      durationMs: 10,
      error: `npm ERR! Bearer secret-token-value ${'z'.repeat(500)}`,
    });
    expect(h.sent.map((entry) => entry.userId)).toEqual(['admin-1', 'admin-2']);
    const data = h.sent[0]!.data as { error: string };
    expect(h.sent[0]!.event).toBe('site.build_failed');
    expect(data.error.length).toBeLessThanOrEqual(200);
    expect(data.error).not.toContain('secret-token-value');
    expect(Object.keys(h.sent[0]!.data).sort()).toEqual(['contentVersion', 'error', 'statusUrl']);
    expect(h.lookups[0]).toMatchObject({ role: { name: 'org_admin' } });
  });
});

describe('ProjectNotifier', () => {
  it('never throws when the recipient lookup or a delivery fails', async () => {
    const h = harness({ holders: ['u1'] });
    h.prisma.membership.findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(h.notifier.holdersOf(ORG, 'projects:publish')).resolves.toEqual([]);
    h.notifications.notifyNow.mockRejectedValueOnce(new Error('smtp down'));
    await expect(h.notifier.send('projects.ai_ready', ORG, ['u1', 'u2'], {})).resolves.toBeUndefined();
    expect(h.notifications.notifyNow).toHaveBeenCalledTimes(2);
  });

  it('does nothing without the notifications slice', async () => {
    const notifier = new ProjectNotifier({} as never, undefined, undefined);
    await expect(notifier.send('projects.ai_ready', ORG, ['u1'], {})).resolves.toBeUndefined();
    expect(notifier.appLink('/projects')).toBe('/projects');
  });
});
