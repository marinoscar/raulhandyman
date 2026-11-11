import { assertEgressAllowed, classifyStatus, INDEXNOW_ENDPOINT, SitePingHandler } from '../../src/site/site-ping.job';
import { snapshotOf } from '../../src/site/site-changed-urls';

const ORG = '11111111-1111-4111-8111-111111111111';
const A = '00000000-0000-4000-8000-00000000000a';
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const project = { id: A, slug: 'fence-repair-conroe', serviceSlug: 'fence-and-deck-repair', title: 'T' };
const manifest = (version = 'v2', projects: unknown[] = [project]) => ({ contentVersion: version, projects });

function build(opts: { key?: string | null; manifest?: unknown; snapshot?: unknown } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const tx = {
    sitePublishState: {
      findFirst: jest.fn(async () => ({ pingSnapshot: opts.snapshot ?? null })),
      upsert: jest.fn(async ({ update }: { update: Record<string, unknown> }) => {
        writes.push(update);
        return {};
      }),
    },
  };
  const scope = { run: jest.fn(async (_job: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(tx)) };
  const site = { buildManifest: jest.fn(async () => opts.manifest ?? manifest()) };
  const keys = { get: jest.fn(async () => (opts.key === undefined ? KEY : opts.key)) };
  const handler = new SitePingHandler({ register: jest.fn() } as never, scope as never, site as never, keys as never);
  return { handler, writes, site };
}

const job = (extra: Record<string, unknown> = {}) =>
  ({ id: 'job-1', type: 'projects.site.ping', orgId: ORG, payload: { orgId: ORG, fromVersion: 'v1', toVersion: 'v2' }, ...extra }) as never;

let fetchMock: jest.SpyInstance;
const respond = (status: number) => fetchMock.mockResolvedValue({ status } as Response);

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
});
afterEach(() => jest.restoreAllMocks());

describe('projects.site.ping', () => {
  it('posts the IndexNow payload and advances the snapshot on 200', async () => {
    const h = build();
    await h.handler.process(job());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(INDEXNOW_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toEqual({
      host: 'raulhandyman.net',
      key: KEY,
      keyLocation: `https://raulhandyman.net/${KEY}.txt`,
      urlList: [
        'https://raulhandyman.net/',
        'https://raulhandyman.net/fence-and-deck-repair/',
        'https://raulhandyman.net/projects/',
        'https://raulhandyman.net/projects/fence-repair-conroe/',
      ],
    });
    expect(h.writes[0]).toMatchObject({ lastPingStatus: 'ok', lastPingUrlCount: 4, pingSnapshot: snapshotOf(manifest() as never) });
  });

  it('accepts 202', async () => {
    respond(202);
    const h = build();
    await h.handler.process(job());
    expect(h.writes[0]).toMatchObject({ lastPingStatus: 'ok' });
  });

  it('submits nothing when nothing changed', async () => {
    const h = build({ snapshot: snapshotOf(manifest() as never) });
    await h.handler.process(job());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.writes[0]).toMatchObject({ lastPingStatus: 'ok', lastPingUrlCount: 0 });
  });

  it.each([422, 403])('%s is a configuration error: recorded, not retried, snapshot kept', async (status) => {
    respond(status);
    const h = build();
    await expect(h.handler.process(job())).resolves.toBeUndefined();
    expect(h.writes[0]).toMatchObject({ lastPingStatus: 'config_error' });
    expect(h.writes[0]).not.toHaveProperty('pingSnapshot');
  });

  it.each([429, 500, 503])('%s throws so the queue retries', async (status) => {
    respond(status);
    const h = build();
    await expect(h.handler.process(job())).rejects.toThrow(String(status));
    expect(h.writes[0]).toMatchObject({ lastPingStatus: 'retrying' });
    expect(h.writes[0]).not.toHaveProperty('pingSnapshot');
  });

  it('retries on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    await expect(build().handler.process(job())).rejects.toThrow('IndexNow request failed');
  });

  it('is skipped with no key configured', async () => {
    const h = build({ key: null });
    await h.handler.process(job());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.site.buildManifest).not.toHaveBeenCalled();
    expect(h.writes[0]).toMatchObject({ lastPingStatus: 'skipped' });
  });

  it('is superseded when the content moved on', async () => {
    const h = build({ manifest: manifest('v3') });
    await h.handler.process(job());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it('refuses a payload for another organization', async () => {
    await expect(build().handler.process(job({ orgId: '22222222-2222-4222-8222-222222222222' }))).rejects.toThrow('organization');
  });
});

describe('egress and status classification', () => {
  it('allows only https api.indexnow.org', () => {
    expect(() => assertEgressAllowed(INDEXNOW_ENDPOINT)).not.toThrow();
    expect(() => assertEgressAllowed('http://api.indexnow.org/indexnow')).toThrow();
    expect(() => assertEgressAllowed('https://example.test/indexnow')).toThrow();
  });
  it('classifies statuses', () => {
    expect(classifyStatus(200).kind).toBe('ok');
    expect(classifyStatus(202).kind).toBe('ok');
    expect(classifyStatus(422).kind).toBe('config');
    expect(classifyStatus(403).kind).toBe('config');
    expect(classifyStatus(400).kind).toBe('config');
    expect(classifyStatus(429).kind).toBe('retry');
    expect(classifyStatus(502).kind).toBe('retry');
  });
});
