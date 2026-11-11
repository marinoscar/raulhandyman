import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { CreateNoteDto, UpdateNoteDto } from './notes.schemas';

/**
 * Every query goes through `forUser()`, so a note is only ever read or
 * written by its owner: the scoped client adds `userId` to every filter and
 * every insert (core's scoped data access).
 */
@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.forUser({ userId }).note.findMany({ orderBy: { createdAt: 'desc' } });
  }

  create(userId: string, input: CreateNoteDto) {
    return this.prisma.forUser({ userId }).note.create({ data: { userId, title: input.title, body: input.body ?? '' } });
  }

  async update(userId: string, id: string, patch: UpdateNoteDto) {
    const db = this.prisma.forUser({ userId });
    const { count } = await db.note.updateMany({ where: { id }, data: patch });
    if (count === 0) throw new NotFoundException('Note not found');
    return db.note.findFirstOrThrow({ where: { id } });
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.forUser({ userId }).note.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Note not found');
  }
}
