import { Module } from '@nestjs/common';

import { sharingModule } from '../sharing.config';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * The sharing slice's sample feature: one shareable record. Mounted by
 * `sharing.slice.ts` next to the slice, because `AccessPolicy`, `GrantsService`
 * and `PrincipalGroupsProvider` are the slice's exports.
 */
@Module({
  imports: [sharingModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
