import { Body, Controller, Delete, Headers, HttpCode, Param, ParseUUIDPipe, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiAcceptedResponse, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiEnabledGuard, AiOrgEnabledInterceptor } from '@marinoscar/platform-api/ai';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';

import { ApplyBodyDto, RegenerateBodyDto, RetouchBodyDto, SuggestBodyDto } from './projects-ai.schemas';
import { ProjectsAiService } from './projects-ai.service';

const IF_MATCH = { name: 'If-Match', description: 'The project version the client last saw; a different current version answers 412.', required: true } as const;

/**
 * The routes that START an AI call: each sits behind `AiEnabledGuard` (403
 * `AI_DISABLED` while AI is off, deployment or organization) and needs
 * `projects:write` AND `ai:use`. They only enqueue a server-only job and answer
 * 202 with its id; the provider call happens in the job.
 */
@ApiTags('Projects AI')
@Controller('projects')
@UseGuards(AiEnabledGuard)
@UseInterceptors(AiOrgEnabledInterceptor)
export class ProjectsAiController {
  constructor(private readonly ai: ProjectsAiService) {}

  @Post(':id/ai/suggest')
  @HttpCode(202)
  @Auth({ permissions: ['projects:write', 'ai:use'] })
  @ApiOperation({ summary: 'Draft copy and alt text from the photos and notes (a background job; 409 while one runs)' })
  @ApiAcceptedResponse({ description: '`{ jobId }` of the `projects.ai.suggest` job' })
  suggest(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: SuggestBodyDto) {
    return this.ai.suggest(orgId, userId, id, body);
  }

  @Post(':id/ai/regenerate')
  @HttpCode(202)
  @Auth({ permissions: ['projects:write', 'ai:use'] })
  @ApiOperation({ summary: 'Ask for another option of one field (only that key of the suggestion is replaced)' })
  @ApiAcceptedResponse({ description: '`{ jobId }` of the `projects.ai.suggest` job' })
  regenerate(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: RegenerateBodyDto) {
    return this.ai.regenerate(orgId, userId, id, body);
  }

  @Post(':id/photos/:photoId/retouch')
  @HttpCode(202)
  @Auth({ permissions: ['projects:write', 'ai:use'] })
  @ApiOperation({ summary: 'Retouch a photo (never a "before" photo: 422 RETOUCH_NOT_ALLOWED; 409 until it is ready)' })
  @ApiAcceptedResponse({ description: '`{ jobId }` of the `projects.photo.retouch` job' })
  retouch(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() body: RetouchBodyDto,
  ) {
    return this.ai.retouch(orgId, userId, id, photoId, body.options);
  }
}

/**
 * The routes that only move data the jobs already stored. No provider is
 * called, so they need `projects:write` alone and keep working while AI is off
 * (an editor can still apply a suggestion that was generated earlier).
 */
@ApiTags('Projects AI')
@Controller('projects')
export class ProjectsAiEditsController {
  constructor(private readonly ai: ProjectsAiService) {}

  @Post(':id/ai/apply')
  @HttpCode(200)
  @Auth({ permissions: ['projects:write'] })
  @ApiHeader(IF_MATCH)
  @ApiOperation({ summary: 'Copy stored suggestions into the editable fields in one transaction (412 stale, 409 none stored)' })
  apply(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApplyBodyDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.ai.apply(orgId, userId, id, body, ifMatch);
  }

  @Delete(':id/photos/:photoId/retouch')
  @Auth({ permissions: ['projects:write'] })
  @ApiOperation({ summary: 'Remove the retouched variant; a photo using it falls back to the enhanced variant' })
  removeRetouch(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    return this.ai.removeRetouch(orgId, userId, id, photoId);
  }
}
