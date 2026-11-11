// The db tier for the sharing slice's sample record: the whole app against a
// real, migrated and seeded PostgreSQL (POSTGRES_USER an ordinary role, so
// row-level security is in force), with the non-production test login. Proves
// what the slice promises for a registered resource type: the owner sees it, a
// stranger gets the same 404 as for a missing record, a grant opens exactly
// the role it names, the grant API is the slice's own, and deleting the
// record leaves no grant behind. Skipped (404) when the sharing slice is off.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaSystemService } from '../src/prisma/prisma-system.service';
import { isSliceEnabled } from '../src/platform/slices/manifest';

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
const body = <T,>(res: { json: <U>() => U }): T => res.json<{ data: T }>().data;

interface DocView {
  id: string;
  title: string;
  role: string | null;
}

const describeIfSharing = isSliceEnabled('sharing') ? describe : describe.skip;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

describe('documents without the sharing slice', () => {
  it('has no route', async () => {
    if (isSliceEnabled('sharing')) return;
    expect((await app.inject({ method: 'GET', url: '/api/documents' })).statusCode).toBe(404);
  });
});

describeIfSharing('documents, shared through the sharing slice', () => {
  const alice = `alice-doc-${run}@example.test`;
  const bob = `bob-doc-${run}@example.test`;
  let aliceToken: string;
  let bobToken: string;
  let documentId: string;

  beforeAll(async () => {
    aliceToken = await login(alice, 'contributor');
    bobToken = await login(bob, 'contributor');
  });

  it('refuses an anonymous caller', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/documents' })).statusCode).toBe(401);
  });

  it('lets its owner write a document in the organization, and shows it as owner', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/documents', headers: as(aliceToken), payload: { title: 'Plan', body: 'v1' } });
    expect(created.statusCode).toBe(201);
    documentId = body<DocView>(created).id;
    expect(body<DocView>(created).role).toBe('owner');
    const list = body<DocView[]>(await app.inject({ method: 'GET', url: '/api/documents', headers: as(aliceToken) }));
    expect(list.find((doc) => doc.id === documentId)?.role).toBe('owner');
  });

  it('answers a stranger exactly as it answers a missing record: 404, and not in their list', async () => {
    const stranger = await app.inject({ method: 'GET', url: `/api/documents/${documentId}`, headers: as(bobToken) });
    const missing = await app.inject({ method: 'GET', url: '/api/documents/00000000-0000-4000-8000-000000000000', headers: as(bobToken) });
    expect(stranger.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(stranger.json()).toMatchObject({ statusCode: 404 });
    expect(body<DocView[]>(await app.inject({ method: 'GET', url: '/api/documents', headers: as(bobToken) })).map((d) => d.id)).not.toContain(documentId);
    expect((await app.inject({ method: 'PATCH', url: `/api/documents/${documentId}`, headers: as(bobToken), payload: { title: 'Mine' } })).statusCode).toBe(404);
  });

  it('opens exactly the role a grant names: viewer reads, only an editor writes, nobody but the owner deletes', async () => {
    const share = (role: 'viewer' | 'editor', token = aliceToken) =>
      app.inject({
        method: 'POST',
        url: '/api/grants',
        headers: as(token),
        payload: { resourceType: 'document', resourceId: documentId, grantee: { kind: 'user', email: bob }, role },
      });
    expect((await share('viewer')).statusCode).toBe(201);

    const read = await app.inject({ method: 'GET', url: `/api/documents/${documentId}`, headers: as(bobToken) });
    expect(read.statusCode).toBe(200);
    expect(body<DocView>(read).role).toBe('viewer');
    expect((await app.inject({ method: 'PATCH', url: `/api/documents/${documentId}`, headers: as(bobToken), payload: { title: 'Edited' } })).statusCode).toBe(404);

    // The grantee cannot re-share what they were only given.
    expect((await share('editor', bobToken)).statusCode).toBe(404);

    // One role per grantee: sharing again replaces it.
    expect((await share('editor')).statusCode).toBe(201);
    const edited = await app.inject({ method: 'PATCH', url: `/api/documents/${documentId}`, headers: as(bobToken), payload: { title: 'Edited' } });
    expect(edited.statusCode).toBe(200);
    expect(body<DocView>(edited)).toMatchObject({ title: 'Edited', role: 'editor' });
    expect((await app.inject({ method: 'DELETE', url: `/api/documents/${documentId}`, headers: as(bobToken) })).statusCode).toBe(404);

    const shared = body<DocView[]>(await app.inject({ method: 'GET', url: '/api/documents?scope=shared', headers: as(bobToken) }));
    expect(shared.map((d) => d.id)).toEqual([documentId]);
    const owned = body<DocView[]>(await app.inject({ method: 'GET', url: '/api/documents?scope=owned', headers: as(bobToken) }));
    expect(owned).toEqual([]);
  });

  it("lists it in the grantee's 'shared with me' with its title, from the type's describe()", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/grants/shared-with-me?resourceType=document', headers: as(bobToken) });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain('Edited');
  });

  it("keeps the row inside its organization: another organization's scope, and no scope at all, see nothing", async () => {
    const prisma = app.get(PrismaService);
    const owned = await prisma.document.count({ where: { id: documentId } });
    expect(owned).toBe(0);
    const elsewhere = await prisma.runInOrg('00000000-0000-4000-8000-0000000000aa', (tx) => tx.document.count({ where: { id: documentId } }));
    expect(elsewhere).toBe(0);
  });

  it('deletes the record and its grants together', async () => {
    const system = app.get(PrismaSystemService);
    const grantsOf = () =>
      system.runAsSystem('migration-tooling', (tx) => (tx as unknown as { grant: { count(args: unknown): Promise<number> } }).grant.count({ where: { resourceType: 'document', resourceId: documentId } }));
    expect(await grantsOf()).toBeGreaterThan(0);

    expect((await app.inject({ method: 'DELETE', url: `/api/documents/${documentId}`, headers: as(aliceToken) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/documents/${documentId}`, headers: as(aliceToken) })).statusCode).toBe(404);
    expect(await grantsOf()).toBe(0);
  });
});
