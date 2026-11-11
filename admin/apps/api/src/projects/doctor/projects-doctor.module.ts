import { Module, type Provider } from '@nestjs/common';
import { CredentialsModule } from '@marinoscar/platform-api/credentials';

import { isSliceEnabled } from '../../platform/slices/manifest';
import {
  AiProjectsReadyDoctorCheck,
  ProjectsMediaIntegrityDoctorCheck,
  SiteBuildFreshnessDoctorCheck,
  SiteContentTokenDoctorCheck,
  SiteIndexNowDoctorCheck,
} from './projects.doctor-checks';

// `ai.projects_ready` only exists while the AI slice is on (there is no AI to check otherwise).
const aiChecks: Provider[] = isSliceEnabled('ai') ? [AiProjectsReadyDoctorCheck] : [];

/**
 * The projects Doctor checks (issue #41), registered in `onModuleInit` of each
 * check. The doctor, settings and prisma modules are global.
 */
@Module({
  imports: [CredentialsModule],
  providers: [SiteContentTokenDoctorCheck, SiteBuildFreshnessDoctorCheck, ProjectsMediaIntegrityDoctorCheck, SiteIndexNowDoctorCheck, ...aiChecks],
})
export class ProjectsDoctorModule {}
