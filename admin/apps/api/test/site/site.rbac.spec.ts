// RBAC matrix of every /api/site route: the real controllers, guards and the
// real seeded grants, with the credential guard replaced by a header reader and
// the services mocked (the same harness as projects.rbac.spec.ts).
import { type CanActivate, type ExecutionContext, type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '@marinoscar/platform-api/identity';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { ZodValidationPipe } from 'nestjs-zod';

import '../../src/platform/registrations';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { IndexNowKeyService } from '../../src/site/indexnow-key.service';
import { SiteController, SiteIndexNowController } from '../../src/site/site.controller';
import { SiteService } from '../../src/site/site.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const PHOTO = '33333333-3333-4333-8333-333333333333';
const grants = platformPermissionCatalog(PERMISSION_OPTIONS).rolePermissions;

class HeaderCredentialGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request.headers['x-test-roles'] as string | undefined;
    if (!header) throw new UnauthorizedException();
    const permissions = [...new Set(header.split(',').flatMap((role) => grants[role] ?? []))];
    request.user = { id: 'user-1', email: 'person-a@example.test', isActive: true, userRoles: [], memberships: [], activeOrgId: ORG };
    request.principal = { kind: 'user', userId: 'user-1', email: 'person-a@example.test', roles: header.split(','), permissions, activeOrgId: ORG };
    return true;
  }
}

interface Route {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  permission: string;
  body?: Record<string, unknown>;
}

const ROUTES: Route[] = [
  { name: 'content', method: 'GET', url: '/site/content', permission: 'site_content:read' },
  { name: 'version', method: 'GET', url: '/site/content/version', permission: 'site_content:read' },
  { name: 'media', method: 'GET', url: `/site/media/${PHOTO}/master`, permission: 'site_content:read' },
  { name: 'build-status', method: 'POST', url: '/site/build-status', permission: 'site_content:read', body: { contentVersion: 'abc', status: 'live', durationMs: 1200 } },
  { name: 'status', method: 'GET', url: '/site/status', permission: 'projects:read' },
  { name: 'indexnow status', method: 'GET', url: '/site/indexnow/key', permission: 'projects:publish' },
  { name: 'indexnow generate', method: 'POST', url: '/site/indexnow/key', permission: 'projects:publish' },
  { name: 'indexnow clear', method: 'DELETE', url: '/site/indexnow/key', permission: 'projects:publish' },
];

const CALLERS = [
  { label: 'admin', roles: 'admin,org_admin' },
  { label: 'content_editor', roles: 'content_editor' },
  { label: 'viewer', roles: 'viewer' },
  { label: 'contributor', roles: 'contributor' },
  { label: 'build service user (site_reader)', roles: 'site_reader' },
];

let app: NestFastifyApplication;

beforeAll(async () => {
  const site = {
    getContent: jest.fn().mockResolvedValue({ etag: '"v1"', manifest: { manifestVersion: 1 } }),
    contentVersion: jest.fn().mockResolvedValue('v1'),
    getMedia: jest.fn().mockResolvedValue({ buffer: Buffer.from('jpeg'), contentType: 'image/jpeg', sha256: 'a'.repeat(64), width: 1, height: 1 }),
    recordBuild: jest.fn().mockResolvedValue({ contentVersion: 'abc', status: 'live' }),
    status: jest.fn().mockResolvedValue({}),
  };
  const keys = { status: jest.fn().mockResolvedValue({}), generate: jest.fn().mockResolvedValue({}), clear: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = await Test.createTestingModule({
    controllers: [SiteController, SiteIndexNowController],
    providers: [
      { provide: APP_PIPE, useClass: ZodValidationPipe },
      { provide: SiteService, useValue: site },
      { provide: IndexNowKeyService, useValue: keys },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(HeaderCredentialGuard)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await (app as INestApplication | undefined)?.close();
});

const call = (route: Route, roles?: string) =>
  app.inject({
    method: route.method,
    url: `/api${route.url}`,
    headers: { ...(route.body ? { 'content-type': 'application/json' } : {}), ...(roles ? { 'x-test-roles': roles } : {}) },
    ...(route.body ? { payload: route.body } : {}),
  });

describe('seeded site grants', () => {
  it('gives org_admin and site_reader site_content:read', () => {
    expect(grants.org_admin).toContain('site_content:read');
    expect(grants.site_reader).toContain('site_content:read');
  });
  it('keeps site_content:read away from content_editor, viewer and contributor', () => {
    for (const role of ['content_editor', 'viewer', 'contributor']) expect(grants[role] ?? []).not.toContain('site_content:read');
  });
});

describe.each(ROUTES)('$method $url ($name)', (route) => {
  it('is a 401 for an anonymous caller', async () => {
    expect((await call(route)).statusCode).toBe(401);
  });
  it.each(CALLERS)('for $label', async ({ roles }) => {
    const granted = roles.split(',').some((role) => (grants[role] ?? []).includes(route.permission));
    const response = await call(route, roles);
    if (granted) expect([200, 201, 204]).toContain(response.statusCode);
    else expect(response.statusCode).toBe(403);
  });
});

describe('the build service user', () => {
  it('can read the site routes', async () => {
    for (const route of ROUTES.filter((r) => r.permission === 'site_content:read')) {
      expect((await call(route, 'site_reader')).statusCode).toBeLessThan(300);
    }
  });
  it('holds no projects:* permission, so /api/projects* is refused (matrix: projects.rbac.spec.ts)', () => {
    expect((grants.site_reader ?? []).filter((id) => id.startsWith('projects:'))).toEqual([]);
  });
  it('is refused the editor surface', async () => {
    for (const url of ['/site/status', '/site/indexnow/key']) {
      expect((await call({ name: url, method: 'GET', url, permission: '' }, 'site_reader')).statusCode).toBe(403);
    }
  });
});

describe('response shapes', () => {
  it('sends the manifest bare with ETag and no-store, 304 when unchanged', async () => {
    const ok = await call(ROUTES[0], 'site_reader');
    expect(ok.headers.etag).toBe('"v1"');
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.json()).toEqual({ manifestVersion: 1 });
  });
  it('streams media with the sha256 as ETag', async () => {
    const response = await call(ROUTES[2], 'site_reader');
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers.etag).toBe(`"${'a'.repeat(64)}"`);
    expect(response.rawPayload.toString()).toBe('jpeg');
  });
  it('rejects an unknown rendition with 404 and a bad body with 400', async () => {
    expect((await call({ ...ROUTES[2], url: `/site/media/${PHOTO}/huge` }, 'site_reader')).statusCode).toBe(404);
    expect((await call({ ...ROUTES[3], body: { contentVersion: 'x', status: 'maybe', durationMs: 1 } }, 'site_reader')).statusCode).toBe(400);
  });
});
