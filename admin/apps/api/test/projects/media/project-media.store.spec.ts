import { Readable } from 'node:stream';
import { registerKeyPrefix, storageKeyPrefixRegistry } from '@marinoscar/platform-api/storage';

import { PROJECT_MEDIA_KEY_PREFIX } from '../../../src/platform/storage/storage-prefixes';
import { ProjectMediaStore } from '../../../src/projects/media/project-media.store';

if (!storageKeyPrefixRegistry.get('project-media')) registerKeyPrefix(PROJECT_MEDIA_KEY_PREFIX);

const FILE = { orgId: 'o1', projectId: 'pr1', photoId: 'ph1', name: 'enhanced.jpg', buffer: Buffer.from('bytes'), mimeType: 'image/jpeg', uploadedById: 'u1' };

function build(existingId: string | null) {
  const tx = {
    storageObject: {
      findFirst: jest.fn(async () => (existingId ? { id: existingId } : null)),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({ id: 'created' })),
    },
  };
  const prisma = { runInOrg: jest.fn(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const uploads: Array<{ key: string; bytes: Buffer }> = [];
  const provider = {
    kind: 's3',
    upload: jest.fn(async (key: string, stream: Readable) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      uploads.push({ key, bytes: Buffer.concat(chunks) });
      return { bucket: 'bucket-a' };
    }),
    download: jest.fn(async () => Readable.from([Buffer.from('ab'), Buffer.from('cd')])),
  };
  const router = { forObject: jest.fn(async () => provider) };
  return { tx, uploads, provider, store: new ProjectMediaStore(prisma as never, provider as never, router as never) };
}

describe('ProjectMediaStore', () => {
  it('writes to the deterministic org-scoped key and creates the storage object', async () => {
    const { store, uploads, tx } = build(null);
    expect(await store.write(FILE)).toBe('created');
    expect(uploads[0].key).toBe('project-media/o1/pr1/ph1/enhanced.jpg');
    expect(uploads[0].bytes.toString()).toBe('bytes');
    expect(tx.storageObject.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: 'o1', storageKey: 'project-media/o1/pr1/ph1/enhanced.jpg', status: 'ready', size: 5n, bucket: 'bucket-a', storageProvider: 's3' }) }),
    );
  });

  it('overwrites the same key and row on a re-run (no second object)', async () => {
    const { store, tx } = build('existing-id');
    expect(await store.write(FILE)).toBe('existing-id');
    expect(tx.storageObject.create).not.toHaveBeenCalled();
    expect(tx.storageObject.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'existing-id' } }));
  });

  it('reads an object back through the provider recorded on its row', async () => {
    const { store, tx } = build(null);
    (tx.storageObject as unknown as { findFirst: jest.Mock }).findFirst.mockResolvedValueOnce({ storageKey: 'k', storageProvider: 's3', bucket: 'b' });
    expect((await store.read('obj', 'o1')).toString()).toBe('abcd');
  });

  it('fails clearly for a missing object', async () => {
    const { store } = build(null);
    await expect(store.read('missing', 'o1')).rejects.toThrow(/not found/);
  });
});
