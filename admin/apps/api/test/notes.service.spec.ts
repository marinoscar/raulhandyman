import { NotFoundException } from '@nestjs/common';

import { NotesService } from '../src/notes/notes.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/** A `PrismaService` whose `forUser()` records the scope and hands back one fake delegate. */
function fakePrisma() {
  const note = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'n1', ...data })),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'n1' }),
  };
  const forUser = jest.fn().mockReturnValue({ note });
  return { prisma: { forUser } as unknown as PrismaService, forUser, note };
}

describe('NotesService', () => {
  it('reads and writes through the caller-scoped client only', async () => {
    const { prisma, forUser, note } = fakePrisma();
    const service = new NotesService(prisma);

    await service.list('u1');
    await service.create('u1', { title: 'First', body: '' });

    expect(forUser).toHaveBeenCalledTimes(2);
    expect(forUser).toHaveBeenNthCalledWith(1, { userId: 'u1' });
    expect(note.create).toHaveBeenCalledWith({ data: { userId: 'u1', title: 'First', body: '' } });
  });

  it("answers 404 for a note that is not the caller's (the scoped update matched nothing)", async () => {
    const { prisma, note } = fakePrisma();
    note.updateMany.mockResolvedValue({ count: 0 });
    note.deleteMany.mockResolvedValue({ count: 0 });
    const service = new NotesService(prisma);

    await expect(service.update('u1', 'other', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('u1', 'other')).rejects.toBeInstanceOf(NotFoundException);
  });
});
