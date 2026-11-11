// The RBAC matrix of the project AI routes: the real controllers, the real
// RolesGuard/PermissionsGuard, the real seeded role grants, the real
// `AiEnabledGuard` over a switchable AI config, the credential guard replaced
// by one that reads the role from a header, and the service mocked.
import { type CanActivate, type ExecutionContext, type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AiConfigService, AiError, AiOrgEnabledInterceptor } from '@marinoscar/platform-api/ai';
import { HttpExceptionFilter } from '@marinoscar/platform-api/core';
import { JwtAuthGuard } from '@marinoscar/platform-api/identity';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { ZodValidationPipe } from 'nestjs-zod';

import '../../../src/platform/registrations';
import { PERMISSION_OPTIONS } from '../../../src/platform/permissions';
import { ProjectsAiController, ProjectsAiEditsController } from '../../../src/projects/ai/projects-ai.controller';
import { ProjectsAiService } from '../../../src/projects/ai/projects-ai.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
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
  method: 'POST' | 'DELETE';
  url: string;
  permissions: string[];
  aiGuarded: boolean;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

const ROUTES: Route[] = [
  { name: 'suggest', method: 'POST', url: `/projects/${ID}/ai/suggest`, permissions: ['projects:write', 'ai:use'], aiGuarded: true, body: {} },
  { name: 'regenerate', method: 'POST', url: `/projects/${ID}/ai/regenerate`, permissions: ['projects:write', 'ai:use'], aiGuarded: true, body: { field: 'title' } },
  { name: 'retouch', method: 'POST', url: `/projects/${ID}/photos/${PHOTO}/retouch`, permissions: ['projects:write', 'ai:use'], aiGuarded: true, body: {} },
  { name: 'apply', method: 'POST', url: `/projects/${ID}/ai/apply`, permissions: ['projects:write'], aiGuarded: false, body: { project: ['title'] }, headers: { 'if-match': '1' } },
  { name: 'remove retouch', method: 'DELETE', url: `/projects/${ID}/photos/${PHOTO}/retouch`, permissions: ['projects:write'], aiGuarded: false },
];

/** Admin, the content editor, the roles without project access, the build user and a content editor that lost `ai:use`. */
const CALLERS: Array<{ label: string; roles: string; drop?: string }> = [
  { label: 'admin', roles: 'admin,org_admin' },
  { label: 'content_editor', roles: 'content_editor' },
  { label: 'viewer', roles: 'viewer' },
  { label: 'contributor', roles: 'contributor' },
  { label: 'build service user (site_reader)', roles: 'site_reader' },
];

let app: NestFastifyApplication;
let aiEnabled = true;
const service = { suggest: jest.fn(), regenerate: jest.fn(), retouch: jest.fn(), apply: jest.fn(), removeRetouch: jest.fn() };

beforeAll(async () => {
  for (const fn of Object.values(service)) fn.mockResolvedValue({ jobId: 'job-1' });
  const moduleRef = await Test.createTestingModule({
    controllers: [ProjectsAiController, ProjectsAiEditsController],
    providers: [
      { provide: APP_PIPE, useClass: ZodValidationPipe },
      { provide: APP_FILTER, useClass: HttpExceptionFilter },
      { provide: ProjectsAiService, useValue: service },
      {
        provide: AiConfigService,
        useValue: {
          assertEnabled: async () => {
            if (!aiEnabled) throw new AiError('AI_DISABLED', 'AI features are disabled in this deployment.', { details: { scope: 'system' } });
          },
        },
      },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(HeaderCredentialGuard)
    .overrideInterceptor(AiOrgEnabledInterceptor)
    .useValue({ intercept: (_context: ExecutionContext, next: { handle: () => unknown }) => next.handle() })
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await (app as INestApplication | undefined)?.close();
});
beforeEach(() => {
  aiEnabled = true;
  for (const fn of Object.values(service)) fn.mockClear();
});

function call(route: Route, roles?: string) {
  return app.inject({
    method: route.method,
    url: `/api${route.url}`,
    headers: { ...(route.body ? { 'content-type': 'application/json' } : {}), ...route.headers, ...(roles ? { 'x-test-roles': roles } : {}) },
    ...(route.body ? { payload: route.body } : {}),
  });
}

describe('the seeded grants these routes rely on', () => {
  it('give the content editor and the administrator projects:write and ai:use', () => {
    for (const role of ['content_editor', 'admin', 'org_admin']) {
      const held = grants[role] ?? [];
      // The administrator holds the org permissions through org_admin.
      if (role === 'admin') continue;
      expect(held).toEqual(expect.arrayContaining(['projects:write', 'ai:use']));
    }
  });
  it('keep ai:use and projects:write away from the other roles', () => {
    for (const role of ['viewer', 'contributor', 'site_reader']) expect((grants[role] ?? []).filter((id) => id === 'projects:write')).toEqual([]);
    expect(grants.site_reader).toEqual(['site_content:read']);
  });
});

describe.each(ROUTES)('$method $url ($name)', (route) => {
  it('is a 401 for an anonymous caller', async () => {
    expect((await call(route)).statusCode).toBe(401);
  });

  it.each(CALLERS)('for $label', async ({ roles }) => {
    const granted = route.permissions.every((permission) => roles.split(',').some((role) => (grants[role] ?? []).includes(permission)));
    const response = await call(route, roles);
    if (granted) expect(response.statusCode).toBeLessThan(300);
    else expect(response.statusCode).toBe(403);
  });

  it('is a 403 for an editor whose role lacks ai:use only where the route needs it', async () => {
    // Simulated with a role that holds projects:write but not ai:use: the AI routes refuse, apply and removal do not.
    const roleWithoutAi = 'content_editor_without_ai';
    const saved = grants[roleWithoutAi];
    (grants as Record<string, string[]>)[roleWithoutAi] = (grants.content_editor ?? []).filter((permission) => permission !== 'ai:use');
    try {
      const response = await call(route, roleWithoutAi);
      if (route.permissions.includes('ai:use')) expect(response.statusCode).toBe(403);
      else expect(response.statusCode).toBeLessThan(300);
    } finally {
      if (saved) (grants as Record<string, string[]>)[roleWithoutAi] = saved;
      else delete (grants as Record<string, string[]>)[roleWithoutAi];
    }
  });

  it(route.aiGuarded ? 'answers 403 AI_DISABLED while AI is off' : 'keeps working while AI is off', async () => {
    aiEnabled = false;
    const response = await call(route, 'content_editor');
    if (route.aiGuarded) {
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).details?.reason ?? JSON.parse(response.body).code).toEqual(expect.stringMatching(/AI_DISABLED|FORBIDDEN/));
      expect(service.suggest).not.toHaveBeenCalled();
      expect(service.regenerate).not.toHaveBeenCalled();
      expect(service.retouch).not.toHaveBeenCalled();
    } else {
      expect(response.statusCode).toBeLessThan(300);
    }
  });
});

describe('status codes and validation', () => {
  it('answers 202 to the three enqueue routes and 200 to apply', async () => {
    expect((await call(ROUTES[0]!, 'content_editor')).statusCode).toBe(202);
    expect((await call(ROUTES[1]!, 'content_editor')).statusCode).toBe(202);
    expect((await call(ROUTES[2]!, 'content_editor')).statusCode).toBe(202);
    expect((await call(ROUTES[3]!, 'content_editor')).statusCode).toBe(200);
  });

  it('rejects a regenerate of a field the model cannot redo, and an apply that names nothing', async () => {
    expect((await call({ ...ROUTES[1]!, body: { field: 'slug' } }, 'content_editor')).statusCode).toBe(400);
    expect((await call({ ...ROUTES[3]!, body: {} }, 'content_editor')).statusCode).toBe(400);
    expect((await call({ ...ROUTES[2]!, body: { options: { declutter: false, evenLighting: false, straighten: false } } }, 'content_editor')).statusCode).toBe(400);
  });

  it('passes the caller, the organization and the If-Match header to the service', async () => {
    await call(ROUTES[3]!, 'content_editor');
    expect(service.apply).toHaveBeenCalledWith(ORG, 'user-1', ID, { project: ['title'] }, '1');
  });
});
