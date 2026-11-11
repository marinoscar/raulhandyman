// The exports slice, configured once: `/api/exports`, the `export.run` and
// `export.purge` jobs, the `user-data` and `org-data` sources and the JSON,
// CSV and XLSX writers. The generated client's datamodel lets the platform
// sources derive each registered model's columns; the app slug names the
// downloads (`<slug>-user-data-2026-10-08.zip`). Defaults for the rest: 7-day
// retention, 5-minute download URLs, 3 exports in flight per subject.
import { ExportsModule } from '@marinoscar/platform-api/exports';
import { APP_SLUG } from '@app/shared';
import { Prisma } from '@prisma/client';

import { ExportsHostModule } from './exports-host.module';

export const exportsModule = ExportsModule.forRoot({
  datamodel: Prisma.dmmf.datamodel,
  appSlug: APP_SLUG,
  imports: [ExportsHostModule],
});
