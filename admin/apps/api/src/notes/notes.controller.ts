import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth, CurrentUser } from '@marinoscar/platform-api/identity';

import { CreateNoteDto, UpdateNoteDto } from './notes.schemas';
import { NotesService } from './notes.service';

/**
 * `/api/notes`: the signed-in user's own notes. Every route declares
 * `@Auth()` with the exact permission the web card declares; there is no
 * global guard, so a route without it would be public (the identity
 * conformance suite fails that).
 */
@ApiTags('Notes')
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @Auth({ permissions: ['notes:read'] })
  list(@CurrentUser('id') userId: string) {
    return this.notes.list(userId);
  }

  @Post()
  @Auth({ permissions: ['notes:write'] })
  create(@CurrentUser('id') userId: string, @Body() body: CreateNoteDto) {
    return this.notes.create(userId, body);
  }

  @Patch(':id')
  @Auth({ permissions: ['notes:write'] })
  update(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateNoteDto) {
    return this.notes.update(userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Auth({ permissions: ['notes:write'] })
  async remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.notes.remove(userId, id);
  }
}
