import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';

import { PhotosService } from './photos.service';
import { AddPhotoDto, CreateProjectDto, ListProjectsQueryDto, ReorderPhotosDto, UpdatePhotoDto, UpdateProjectDto } from './projects.schemas';
import { parseIfMatch, ProjectsService } from './projects.service';
import { SitePublishService } from './site-publish.service';

const IF_MATCH = { name: 'If-Match', description: 'The project version the client last saw; a different current version answers 412.', required: true } as const;

/**
 * `/api/projects`: the handyman site's portfolio entries. Every route declares
 * the exact permission the web card declares. The organization comes from the
 * credential (`@CurrentOrg()`), never from the request body.
 */
@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly photos: PhotosService,
    private readonly site: SitePublishService,
  ) {}

  @Get()
  @Auth({ permissions: ['projects:read'] })
  @ApiOperation({ summary: 'List projects (paginated; filter by status, service and text), each with a signed cover thumbnail URL and its SEO error count' })
  list(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Query() query: ListProjectsQueryDto) {
    return this.projects.list(orgId, userId, query);
  }

  // Declared before `:id` so `catalog` is not parsed as an id.
  @Get('catalog')
  @Auth({ permissions: ['projects:read'] })
  @ApiOperation({ summary: 'The service and town catalog the pickers use (shared with the public site)' })
  catalog() {
    return this.projects.catalog();
  }

  @Post()
  @Auth({ permissions: ['projects:write'] })
  @ApiOperation({ summary: 'Create a draft project; the slug is generated and kept unique' })
  create(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Body() body: CreateProjectDto) {
    return this.projects.create(orgId, userId, body);
  }

  @Get(':id')
  @Auth({ permissions: ['projects:read'] })
  @ApiOperation({ summary: 'A project with its sorted photos (signed previews) and its SEO lint result' })
  get(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(orgId, userId, id);
  }

  @Patch(':id')
  @Auth({ permissions: ['projects:write'] })
  @ApiHeader(IF_MATCH)
  @ApiOperation({ summary: 'Edit a project (optimistic concurrency: 412 on a stale If-Match)' })
  update(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProjectDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.projects.update(orgId, userId, id, body, ifMatch);
  }

  @Delete(':id')
  @HttpCode(204)
  @Auth({ permissions: ['projects:write'] })
  @ApiOperation({ summary: 'Delete a draft or archived project and its storage objects (409 while published)' })
  async remove(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.projects.remove(orgId, userId, id);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Auth({ permissions: ['projects:publish'] })
  @ApiHeader(IF_MATCH)
  @ApiOperation({ summary: 'Publish a project; 422 lists the SEO errors that block it' })
  @ApiOkResponse({ description: 'The published project and the new content version' })
  publish(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.site.publish(orgId, userId, id, parseIfMatch(ifMatch));
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @Auth({ permissions: ['projects:publish'] })
  @ApiHeader({ ...IF_MATCH, required: false })
  @ApiOperation({ summary: 'Take a project off the site (back to draft)' })
  unpublish(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.site.unpublish(orgId, userId, id, ifMatch === undefined ? undefined : parseIfMatch(ifMatch));
  }

  @Post(':id/photos')
  @Auth({ permissions: ['projects:write'] })
  @ApiOperation({ summary: 'Attach a ready image the caller uploaded; processing starts in the background' })
  addPhoto(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: AddPhotoDto) {
    return this.photos.add(orgId, userId, id, body);
  }

  // Declared before `:photoId` so `reorder` is not parsed as a photo id.
  @Post(':id/photos/reorder')
  @HttpCode(200)
  @Auth({ permissions: ['projects:write'] })
  @ApiOperation({ summary: 'Set the photo order (the full set of photo ids)' })
  reorderPhotos(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReorderPhotosDto) {
    return this.photos.reorder(orgId, userId, id, body);
  }

  @Patch(':id/photos/:photoId')
  @Auth({ permissions: ['projects:write'] })
  @ApiOperation({ summary: 'Edit a photo (role, alt text, caption, file slug, focal point, chosen variant)' })
  updatePhoto(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() body: UpdatePhotoDto,
  ) {
    return this.photos.update(orgId, userId, id, photoId, body);
  }

  @Post(':id/photos/:photoId/reprocess')
  @HttpCode(200)
  @Auth({ permissions: ['projects:write'] })
  @ApiOperation({ summary: 'Retry the processing of a photo (back to pending, error cleared, every stage enqueued; 409 while it is processing)' })
  @ApiOkResponse({ description: 'The updated photo with its signed previews' })
  reprocessPhoto(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ) {
    return this.photos.reprocess(orgId, userId, id, photoId);
  }

  @Delete(':id/photos/:photoId')
  @HttpCode(204)
  @Auth({ permissions: ['projects:write'] })
  @ApiOperation({ summary: 'Delete a photo and its storage objects' })
  async removePhoto(
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<void> {
    await this.photos.remove(orgId, userId, id, photoId);
  }
}
