// The db tier (`npm run test:db`): the whole app, booted against a real,
// migrated and seeded PostgreSQL (POSTGRES_* in the environment), driven
// through HTTP with the non-production test login. Proves the composition:
// identity guards the routes, the seed wrote the permissions, the scoped
// client isolates users, the settings namespace and the job work end to end,
// and the host core around them (the `{ data }` envelope, request ids,
// maintenance mode, `/api/docs`).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../src/main';
import { NotesArchiveHandler } from '../src/notes/notes-archive.job';
import { PrismaService } from '../src/prisma/prisma.service';

let app: NestFastifyApplication;
const run = `${Date.now()}`;

async function login(email: string, role: 'admin' | 'contributor' | 'viewer'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/test/login', payload: { email, role } });
  expect(res.statusCode).toBe(302);
  const token = new URL(String(res.headers.location)).searchParams.get('token');
  if (!token) throw new Error(`test login for ${email} returned no token`);
  return token;
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });

/** A success body, unwrapped from the host core's `{ data, meta }` envelope. */
const body = <T,>(res: { json: <U>() => U }): T => res.json<{ data: T }>().data;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

describe('notes, end to end', () => {
  it('refuses an anonymous caller', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/notes' })).statusCode).toBe(401);
  });

  it("lets a contributor write notes that only they can see", async () => {
    const alice = await login(`alice-${run}@example.test`, 'contributor');
    const bob = await login(`bob-${run}@example.test`, 'contributor');

    const created = await app.inject({ method: 'POST', url: '/api/notes', headers: as(alice), payload: { title: 'Plan' } });
    expect(created.statusCode).toBe(201);
    const note = body<{ id: string; title: string }>(created);
    expect(note.title).toBe('Plan');

    const mine = await app.inject({ method: 'GET', url: '/api/notes', headers: as(alice) });
    expect(body<Array<{ id: string }>>(mine).map((n) => n.id)).toContain(note.id);
    const theirs = await app.inject({ method: 'GET', url: '/api/notes', headers: as(bob) });
    expect(body<Array<{ id: string }>>(theirs).map((n) => n.id)).not.toContain(note.id);

    const stolen = await app.inject({ method: 'PATCH', url: `/api/notes/${note.id}`, headers: as(bob), payload: { title: 'Mine now' } });
    expect(stolen.statusCode).toBe(404);
  });

  it('answers 403 to a viewer writing and 400 to an invalid body', async () => {
    const viewer = await login(`vera-${run}@example.test`, 'viewer');
    expect((await app.inject({ method: 'POST', url: '/api/notes', headers: as(viewer), payload: { title: 'x' } })).statusCode).toBe(403);
    const writer = await login(`wes-${run}@example.test`, 'contributor');
    expect((await app.inject({ method: 'POST', url: '/api/notes', headers: as(writer), payload: { title: '' } })).statusCode).toBe(400);
  });

  it('archives untouched notes when an admin turns the setting on, and the Doctor reports it', async () => {
    const admin = await login(`root-${run}@example.test`, 'admin');
    const author = await login(`ann-${run}@example.test`, 'contributor');
    const created = await app.inject({ method: 'POST', url: '/api/notes', headers: as(author), payload: { title: 'Old' } });
    const id = body<{ id: string }>(created).id;
    await app.get(PrismaService).$executeRaw`UPDATE notes SET updated_at = now() - interval '10 days' WHERE id = ${id}::uuid`;

    const patched = await app.inject({ method: 'PATCH', url: '/api/system-settings', headers: as(admin), payload: { notes: { archiveAfterDays: 7 } } });
    expect(patched.statusCode).toBe(200);

    await app.get(NotesArchiveHandler).process({ id: `test-${run}` } as never);
    const after = await app.inject({ method: 'GET', url: '/api/notes', headers: as(author) });
    expect(body<Array<{ id: string; archived: boolean }>>(after).find((n) => n.id === id)?.archived).toBe(true);

    const doctor = await app.inject({ method: 'GET', url: '/api/admin/doctor', headers: as(admin) });
    expect(doctor.statusCode).toBe(200);
    expect(JSON.stringify(doctor.json())).toContain('notes.archive');
  });

  it('wraps every success in the { data, meta } envelope and echoes the request id (the host core)', async () => {
    const writer = await login(`rid-${run}@example.test`, 'contributor');
    const res = await app.inject({ method: 'GET', url: '/api/notes', headers: { ...as(writer), 'x-request-id': `rid-${run}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: expect.any(Array), meta: { timestamp: expect.any(String) } });
    expect(res.headers['x-request-id']).toBe(`rid-${run}`);
  });

  it('holds traffic back during a maintenance window, lets the admin through, and closes it', async () => {
    const admin = await login(`ops-${run}@example.test`, 'admin');
    const writer = await login(`mia-${run}@example.test`, 'contributor');
    const open = await app.inject({ method: 'PUT', url: '/api/admin/maintenance', headers: as(admin), payload: { enabled: true, allowAdmins: true } });
    expect(open.statusCode).toBe(200);
    expect(body<{ enabled: boolean; source: string }>(open)).toMatchObject({ enabled: true, source: 'persisted' });
    try {
      const blocked = await app.inject({ method: 'GET', url: '/api/notes', headers: as(writer) });
      expect(blocked.statusCode).toBe(503);
      expect(blocked.headers['retry-after']).toBe('30');
      expect(blocked.json()).toMatchObject({ details: { reason: 'MAINTENANCE_MODE' } });
      expect((await app.inject({ method: 'GET', url: '/api/notes', headers: as(admin) })).statusCode).toBe(200);
    } finally {
      const closed = await app.inject({ method: 'PUT', url: '/api/admin/maintenance', headers: as(admin), payload: { enabled: false } });
      expect(closed.statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/api/notes', headers: as(writer) })).statusCode).toBe(200);
  });

  it('serves the API reference and its OpenAPI document', async () => {
    const page = await app.inject({ method: 'GET', url: '/api/docs' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    const document = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(document.statusCode).toBe(200);
    expect(Object.keys(document.json<{ paths: Record<string, unknown> }>().paths)).toEqual(
      expect.arrayContaining(['/api/notes', '/api/admin/maintenance']),
    );
  });
});
