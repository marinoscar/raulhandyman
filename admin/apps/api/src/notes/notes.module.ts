import { Module } from '@nestjs/common';

import { NotesArchiveHandler, NotesArchiveTask } from './notes-archive.job';
import { NotesController } from './notes.controller';
import { NotesArchiveDoctorCheck } from './notes.doctor-check';
import { NotesService } from './notes.service';
import './notes.settings';

/**
 * The sample domain module: one user-owned model (`Note`), one permission
 * pair, one settings namespace, one job and its enqueue-only cron, one
 * Doctor check. Copy its shape for your first feature (README, "Add your
 * first feature"). The settings, jobs and doctor slices are global, so it
 * imports none of them.
 */
@Module({
  controllers: [NotesController],
  providers: [NotesService, NotesArchiveHandler, NotesArchiveTask, NotesArchiveDoctorCheck],
})
export class NotesModule {}
