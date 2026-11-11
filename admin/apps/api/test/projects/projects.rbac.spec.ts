// The RBAC matrix of every /api/projects route: the real controller, the real
// RolesGuard/PermissionsGuard and the real seeded role grants
// (`platformPermissionCatalog(PERMISSION_OPTIONS).rolePermissions`), with the
// credential guard replaced by one that reads the caller's role from a header
// and the services mocked. An anonymous request is a 401; a signed-in caller
// without the permission is a 403; with it, the route is reached.
import { type CanActivate, type ExecutionContext, type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '@marinoscar/platform-api/identity';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { ZodValidationPipe } from 'nestjs-zod';

import '../../src/platform/registrations';
import { PERMISSION_OPTIONS } from '../../src/platform/permissions';
import { PhotosService } from '../../src/projects/photos.service';
import { ProjectsController } from '../../src/projects/projects.controller';
import { ProjectsService } from '../../src/projects/projects.service';
import { SitePublishService } from '../../src/projects/site-publish.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const PHOTO = '33333333-3333-4333-8333-333333333333';
const OBJECT = '44444444-4444-4444-8444-444444444444';
const grants = platformPermissionCatalog(PERMISSION_OPTIONS).rolePermissions;

/** Test credential guard: `x-test-roles: a,b` names the caller's roles; none means anonymous. */
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  permission: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

const ROUTES: Route[] = [
  { name: 'list', method: 'GET', url: '/projects', permission: 'projects:read' },
  { name: 'catalog', method: 'GET', url: '/projects/catalog', permission: 'projects:read' },
  { name: 'get', method: 'GET', url: `/projects/${ID}`, permission: 'projects:read' },
  { name: 'create', method: 'POST', url: '/projects', permission: 'projects:write', body: { serviceSlug: 'drywall-repair', townSlug: 'conroe' } },
  { name: 'update', method: 'PATCH', url: `/projects/${ID}`, permission: 'projects:write', body: { title: 'A new title' }, headers: { 'if-match': '1' } },
  { name: 'delete', method: 'DELETE', url: `/projects/${ID}`, permission: 'projects:write' },
  { name: 'publish', method: 'POST', url: `/projects/${ID}/publish`, permission: 'projects:publish', headers: { 'if-match': '1' } },
  { name: 'unpublish', method: 'POST', url: `/projects/${ID}/unpublish`, permission: 'projects:publish' },
  { name: 'add photo', method: 'POST', url: `/projects/${ID}/photos`, permission: 'projects:write', body: { storageObjectId: OBJECT } },
  { name: 'reorder photos', method: 'POST', url: `/projects/${ID}/photos/reorder`, permission: 'projects:write', body: { photoIds: [PHOTO] } },
  { name: 'update photo', method: 'PATCH', url: `/projects/${ID}/photos/${PHOTO}`, permission: 'projects:write', body: { caption: 'Finished wall' } },
  { name: 'reprocess photo', method: 'POST', url: `/projects/${ID}/photos/${PHOTO}/reprocess`, permission: 'projects:write' },
  { name: 'delete photo', method: 'DELETE', url: `/projects/${ID}/photos/${PHOTO}`, permission: 'projects:write' },
];

/** Caller roles: the org roles the matrix covers, `admin` standing for the signed-in administrator (system `admin` plus `org_admin`). */
const CALLERS: Array<{ label: string; roles: string }> = [
  { label: 'admin', roles: 'admin,org_admin' },
  { label: 'content_editor', roles: 'content_editor' },
  { label: 'viewer', roles: 'viewer' },
  { label: 'contributor', roles: 'contributor' },
  { label: 'build service user (site_reader)', roles: 'site_reader' },
];

let app: NestFastifyApplication;

beforeAll(async () => {
  const mock = (names: string[]) => Object.fromEntries(names.map((name) => [name, jest.fn().mockResolvedValue({ ok: true })]));
  const moduleRef = await Test.createTestingModule({
    controllers: [ProjectsController],
    providers: [
      { provide: APP_PIPE, useClass: ZodValidationPipe },
      { provide: ProjectsService, useValue: { ...mock(['list', 'create', 'get', 'update', 'remove']), catalog: jest.fn().mockReturnValue({ version: 1 }) } },
      { provide: PhotosService, useValue: mock(['add', 'update', 'remove', 'reorder', 'reprocess']) },
      { provide: SitePublishService, useValue: mock(['publish', 'unpublish']) },
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

function call(route: Route, roles?: string) {
  return app.inject({
    method: route.method,
    url: `/api${route.url}`,
    headers: { ...(route.body ? { 'content-type': 'application/json' } : {}), ...route.headers, ...(roles ? { 'x-test-roles': roles } : {}) },
    ...(route.body ? { payload: route.body } : {}),
  });
}

describe('seeded grants of the content roles', () => {
  it('gives content_editor the project permissions, uploads and AI, and nothing administrative', () => {
    expect(grants.content_editor).toEqual(
      expect.arrayContaining(['projects:read', 'projects:write', 'projects:publish', 'storage:read', 'storage:write', 'ai:use']),
    );
    for (const forbidden of ['users:read', 'system_settings:read', 'system_settings:write', 'site_content:read', 'ai_config:read', 'storage_config:read']) {
      expect(grants.content_editor).not.toContain(forbidden);
    }
  });

  it('gives the build service user site_content:read and nothing else', () => {
    expect(grants.site_reader).toEqual(['site_content:read']);
  });

  it('keeps projects:* away from viewer and contributor', () => {
    for (const role of ['viewer', 'contributor']) {
      expect((grants[role] ?? []).filter((id) => id.startsWith('projects:') || id === 'site_content:read')).toEqual([]);
    }
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

describe('the administrator and editor reach every route', () => {
  it.each(['admin,org_admin', 'content_editor'])('%s', async (roles) => {
    for (const route of ROUTES) expect([200, 201, 204]).toContain((await call(route, roles)).statusCode);
  });
});

describe('validation runs after the permission check', () => {
  it('answers 400 to an unknown service slug', async () => {
    const response = await call({ ...ROUTES[3]!, body: { serviceSlug: 'not-a-service', townSlug: 'conroe' } }, 'content_editor');
    expect(response.statusCode).toBe(400);
  });
});
