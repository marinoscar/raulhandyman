import { changedPaths, parseSnapshot, snapshotOf, toUrls, type PingSnapshot } from '../../src/site/site-changed-urls';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const snap = (...projects: Array<[string, string, string, string]>): PingSnapshot => ({
  contentVersion: 'v',
  projects: projects.map(([id, slug, serviceSlug, hash]) => ({ id, slug, serviceSlug, hash })),
});

describe('changedPaths', () => {
  it('first ping: every published project is new', () => {
    expect(changedPaths(null, snap([A, 'one', 'drywall-repair', 'h1']))).toEqual(['/', '/drywall-repair/', '/projects/', '/projects/one/']);
  });
  it('no change means no URLs', () => {
    const s = snap([A, 'one', 'drywall-repair', 'h1']);
    expect(changedPaths(s, s)).toEqual([]);
  });
  it('a newly published project', () => {
    const paths = changedPaths(snap([A, 'one', 'svc-a', 'h1']), snap([A, 'one', 'svc-a', 'h1'], [B, 'two', 'svc-b', 'h2']));
    expect(paths).toEqual(['/', '/projects/', '/projects/two/', '/svc-b/']);
  });
  it('an unpublished project', () => {
    const paths = changedPaths(snap([A, 'one', 'svc-a', 'h1'], [B, 'two', 'svc-b', 'h2']), snap([A, 'one', 'svc-a', 'h1']));
    expect(paths).toEqual(['/', '/projects/', '/projects/two/', '/svc-b/']);
  });
  it('an updated project', () => {
    expect(changedPaths(snap([A, 'one', 'svc-a', 'h1']), snap([A, 'one', 'svc-a', 'h9']))).toEqual(['/', '/projects/', '/projects/one/', '/svc-a/']);
  });
  it('a renamed slug and a moved service cover the old and new pages', () => {
    const paths = changedPaths(snap([A, 'old', 'svc-a', 'h1']), snap([A, 'new', 'svc-b', 'h1']));
    expect(paths).toEqual(['/', '/projects/', '/projects/new/', '/projects/old/', '/svc-a/', '/svc-b/']);
  });
});

describe('snapshotOf and parseSnapshot', () => {
  const project = { id: A, slug: 'one', serviceSlug: 'svc-a', updatedAt: '2026-01-01T00:00:00Z', title: 'T' };
  it('ignores updatedAt but sees content changes', () => {
    const base = snapshotOf({ contentVersion: 'v', projects: [project] as never });
    expect(snapshotOf({ contentVersion: 'v', projects: [{ ...project, updatedAt: '2027-01-01T00:00:00Z' }] as never }).projects[0].hash).toBe(base.projects[0].hash);
    expect(snapshotOf({ contentVersion: 'v', projects: [{ ...project, title: 'U' }] as never }).projects[0].hash).not.toBe(base.projects[0].hash);
  });
  it('round-trips and rejects malformed JSON', () => {
    const base = snapshotOf({ contentVersion: 'v', projects: [project] as never });
    expect(parseSnapshot(JSON.parse(JSON.stringify(base)))).toEqual(base);
    expect(parseSnapshot({ contentVersion: 'v', projects: [{ id: 1 }] })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });
  it('builds absolute URLs on the site host', () => {
    expect(toUrls(['/', '/projects/x/'])).toEqual(['https://raulhandyman.net/', 'https://raulhandyman.net/projects/x/']);
  });
});
