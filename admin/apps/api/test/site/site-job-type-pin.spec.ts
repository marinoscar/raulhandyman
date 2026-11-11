import { SITE_PING_JOB, SitePingHandler } from '../../src/site/site-ping.job';

// A job type string is permanent once jobs of that type exist.
describe('site job type pins', () => {
  it('pins projects.site.ping', () => {
    expect(SITE_PING_JOB).toBe('projects.site.ping');
  });

  it('is server-only with the declared profile', () => {
    const handler = new SitePingHandler({ register: jest.fn() } as never, {} as never, {} as never, {} as never);
    expect(handler.type).toBe('projects.site.ping');
    expect(handler.profile).toEqual({ maxRuntimeMs: 30_000, maxAttempts: 5 });
    expect('nodeResultSchema' in handler).toBe(false);
    expect('persistNodeResult' in handler).toBe(false);
  });
});
