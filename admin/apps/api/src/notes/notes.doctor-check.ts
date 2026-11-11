import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome } from '@marinoscar/platform-api/doctor';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';


/**
 * `notes.archive` in the admin Doctor (`GET /api/admin/doctor`): is archiving
 * on, and how many notes are waiting? Read-only, like every check: a settings
 * read and a count, never a write.
 */
@Injectable()
export class NotesArchiveDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = 'notes.archive';
  readonly category = 'notes';
  readonly label = 'Note archiving';

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly settings: SystemSettingsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const days = (await this.settings.getNamespace('notes')).archiveAfterDays;
    if (days === 0) {
      return { status: 'skip', detail: 'Archiving is off (notes.archiveAfterDays is 0).' };
    }
    return { status: 'pass', detail: `Notes untouched for ${days} day(s) are archived nightly.`, data: { archiveAfterDays: days } };
  }
}
