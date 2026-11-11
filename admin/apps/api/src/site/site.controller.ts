import { Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, CurrentOrg, CurrentUser } from '@marinoscar/platform-api/identity';
import type { FastifyReply } from 'fastify';

import { IndexNowKeyService } from './indexnow-key.service';
import { BuildStatusDto, mediaRenditionSchema } from './site.schemas';
import { etagMatches, SiteService } from './site.service';

const IF_NONE_MATCH = { name: 'If-None-Match', description: 'The ETag last seen; a match answers 304 with no body.', required: false } as const;

/**
 * `/api/site`: what the static site build reads (published content, media) and
 * reports (build status). The build credential is a personal access token of a
 * dedicated service user holding only `site_content:read`. No route is public.
 */
@ApiTags('Site')
@Controller('site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  /**
   * The manifest is sent as the bare JSON document (the frozen contract), not in
   * the `{ data }` envelope: the handler writes the reply itself.
   */
  @Get('content')
  @Auth({ permissions: ['site_content:read'] })
  @ApiHeader(IF_NONE_MATCH)
  @ApiOperation({ summary: 'The published content manifest (v1); ETag is the content version, 304 when unchanged' })
  @ApiOkResponse({ description: 'The manifest document (not enveloped)' })
  async content(@CurrentOrg() orgId: string, @Res() reply: FastifyReply, @Headers('if-none-match') ifNoneMatch?: string): Promise<void> {
    const { etag, manifest } = await this.site.getContent(orgId, ifNoneMatch);
    reply.header('Cache-Control', 'no-store').header('ETag', etag);
    if (!manifest) {
      reply.status(304).send();
      return;
    }
    reply.status(200).header('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(manifest));
  }

  @Get('content/version')
  @Auth({ permissions: ['site_content:read'] })
  @ApiOperation({ summary: 'The current content version only (a tiny response for the rebuild cron)' })
  async version(@CurrentOrg() orgId: string) {
    return { contentVersion: await this.site.contentVersion(orgId) };
  }

  @Get('media/:photoId/:rendition')
  @Auth({ permissions: ['site_content:read'] })
  @ApiHeader(IF_NONE_MATCH)
  @ApiOperation({ summary: 'The bytes of one rendition of a photo of a published project (master, card4x3, hero16x9, og-branded); ETag is the sha256' })
  async media(
    @CurrentOrg() orgId: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Param('rendition') renditionParam: string,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ): Promise<void> {
    // The manifest path ends in `.jpg` (`media/<id>/master.jpg`); accept it with or without the extension.
    const parsed = mediaRenditionSchema.safeParse(renditionParam.replace(/\.jpg$/, ''));
    if (!parsed.success) throw new NotFoundException('Media not found');
    const file = await this.site.getMedia(orgId, photoId, parsed.data);
    const etag = `"${file.sha256}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, no-cache');
    if (etagMatches(ifNoneMatch, etag)) {
      reply.status(304).send();
      return;
    }
    reply.status(200).header('Content-Type', file.contentType).header('Content-Length', file.buffer.length).send(file.buffer);
  }

  @Post('build-status')
  @HttpCode(200)
  @Auth({ permissions: ['site_content:read'] })
  @ApiOperation({ summary: 'The site build reports the version it built: live or failed (a live report requests the IndexNow ping)' })
  buildStatus(@CurrentOrg() orgId: string, @Body() body: BuildStatusDto) {
    return this.site.recordBuild(orgId, body);
  }

  @Get('status')
  @Auth({ permissions: ['projects:read'] })
  @ApiOperation({ summary: 'Publish and build state for the editor UI' })
  status(@CurrentOrg() orgId: string) {
    return this.site.status(orgId);
  }
}

/** `/api/site/indexnow/key`: the IndexNow key (public by design) behind the "Site publishing" card. */
@ApiTags('Site')
@Controller('site/indexnow')
export class SiteIndexNowController {
  constructor(private readonly keys: IndexNowKeyService) {}

  @Get('key')
  @Auth({ permissions: ['projects:publish'] })
  @ApiOperation({ summary: 'Whether an IndexNow key is configured, and the key (public by design)' })
  status() {
    return this.keys.status();
  }

  @Post('key')
  @HttpCode(200)
  @Auth({ permissions: ['projects:publish'] })
  @ApiOperation({ summary: 'Generate a new IndexNow key (32 hex characters), replacing any existing one' })
  generate(@CurrentUser('id') userId: string) {
    return this.keys.generate(userId);
  }

  @Delete('key')
  @HttpCode(204)
  @Auth({ permissions: ['projects:publish'] })
  @ApiOperation({ summary: 'Remove the IndexNow key (pings are skipped until a new one is generated)' })
  async clear(@CurrentUser('id') userId: string): Promise<void> {
    await this.keys.clear(userId);
  }
}
