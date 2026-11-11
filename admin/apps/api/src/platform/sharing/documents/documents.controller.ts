import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Principal } from '@marinoscar/platform-api/core';
import { Auth, CurrentPrincipal } from '@marinoscar/platform-api/identity';

import { CreateDocumentDto, ListDocumentsQueryDto, UpdateDocumentDto } from './documents.schemas';
import { DocumentsService } from './documents.service';

/**
 * `/api/documents`: the sharing slice's sample records. The route is the app's
 * ordinary `@Auth()` route; the RECORD's access (owner, grant, group) is the
 * sharing slice's decision (`AccessPolicy`), so a document the caller may not
 * see is a 404 and the permission strings are not repeated here. Sharing it is
 * the slice's own `POST /api/grants` with `resourceType: 'document'`.
 */
@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @Auth()
  list(@CurrentPrincipal() principal: Principal, @Query() query: ListDocumentsQueryDto) {
    return this.documents.list(principal, query.scope);
  }

  @Post()
  @Auth()
  create(@CurrentPrincipal() principal: Principal, @Body() body: CreateDocumentDto) {
    return this.documents.create(principal, body);
  }

  @Get(':id')
  @Auth()
  get(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.get(principal, id);
  }

  @Patch(':id')
  @Auth()
  update(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDocumentDto) {
    return this.documents.update(principal, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Auth()
  async remove(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.documents.remove(principal, id);
  }
}
