import { Module } from '@nestjs/common';

import { AiModule } from '../../platform/ai/ai.config';
import { ProjectsEventsModule } from '../events/projects-events.module';
import { ProjectMediaModule } from '../media/project-media.module';
import { ProjectsModule } from '../projects.module';
import { ProjectsAiController, ProjectsAiEditsController } from './projects-ai.controller';
import { ProjectsAiService } from './projects-ai.service';
import { RetouchJobHandler } from './retouch.job';
import { SuggestJobHandler } from './suggest.job';

/**
 * AI copy suggestions and photo retouch for projects. Mounted only while the
 * `ai` slice is enabled (`app.module.ts`), because it imports the configured
 * `AiModule`. The jobs, settings and prisma modules are global;
 * `AiEventsPublisher` comes from `ProjectsEventsModule` (issue #39).
 */
@Module({
  imports: [AiModule, ProjectsModule, ProjectMediaModule, ProjectsEventsModule],
  controllers: [ProjectsAiController, ProjectsAiEditsController],
  providers: [ProjectsAiService, SuggestJobHandler, RetouchJobHandler],
})
export class ProjectsAiModule {}
