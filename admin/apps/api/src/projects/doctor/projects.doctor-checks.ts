// =============================================================================
// Doctor checks for the handyman site (issue #41)
// =============================================================================
//
// Five read-only checks, category `projects`, registered in `onModuleInit` like
// the notes example: "why is my project not on the website?" answered from
// Admin, Doctor. Each reads rows (a `doctor` system-scoped read across
// organizations, the worst result wins) or a credential's existence; none
// writes, enqueues, calls a provider or reads a storage object. The decision
// of each check is a pure function over plain data, exported for the tests.
//
//   site.content_token        the build token (a PAT of a `site_content:read` user) is alive and used
//   site.build_freshness      the built site matches the published content
//   projects.media_integrity  every photo of a published project has its renditions
//   ai.projects_ready         a vision + structured-output model (copy) and an image-edit model (retouch) are enabled
//   site.indexnow             an IndexNow key is set and the last ping was not refused
//
// Outcomes carry counts, ages and photo ids only: never a token, a key or a
// note. The details name the cause and the remedy.
// =============================================================================

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { DoctorCheckRegistry, type DoctorCheck, type DoctorCheckOutcome, type DoctorStatus } from '@marinoscar/platform-api/doctor';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { INDEXNOW_CREDENTIAL_NAME, INDEXNOW_CREDENTIAL_PURPOSE } from '../../site/indexnow-key.service';

export const PROJECTS_DOCTOR_CATEGORY = 'projects';
export const SITE_SETTINGS_PATH = '/admin/settings/site-publishing';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RANK: Record<DoctorStatus, number> = { fail: 3, warn: 2, pass: 1, skip: 0 } as Record<DoctorStatus, number>;

/** The worst outcome of several (fail over warn over pass over skip). */
export function worst(outcomes: readonly DoctorCheckOutcome[]): DoctorCheckOutcome {
  return outcomes.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));
}

const minutes = (ms: number): number => Math.round(ms / MINUTE);

// ---------------------------------------------------------------------------
// site.content_token
// ---------------------------------------------------------------------------

export interface TokenFacts {
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Pass: used within 10 min and not expiring within 14 days. Warn: expiring soon, or unused 10 min to 24 h. Fail: none, expired, or unused over 24 h. */
export function decideContentToken(tokens: readonly TokenFacts[], now: number): DoctorCheckOutcome {
  const live = tokens.filter((token) => token.expiresAt.getTime() > now);
  if (tokens.length === 0) {
    return {
      status: 'fail',
      detail: 'No build token exists: the website cannot fetch published content.',
      remedy: 'Create a personal access token for the site build service user (role site_reader) and save it on the build server.',
      data: { tokens: 0 },
    };
  }
  if (live.length === 0) {
    return {
      status: 'fail',
      detail: 'Every build token has expired.',
      remedy: 'Create a new token for the site build service user and replace the one on the build server.',
      data: { tokens: tokens.length, live: 0 },
    };
  }
  // The token the cron really uses is the one used most recently; a never-used one ranks last.
  const best = [...live].sort((a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0) || b.expiresAt.getTime() - a.expiresAt.getTime())[0]!;
  const expiresInDays = Math.floor((best.expiresAt.getTime() - now) / DAY);
  const idleMs = best.lastUsedAt ? now - best.lastUsedAt.getTime() : null;
  const data = { tokens: tokens.length, live: live.length, expiresInDays, idleMinutes: idleMs === null ? null : minutes(idleMs) };
  const neverUsedYoung = idleMs === null && now - best.createdAt.getTime() <= DAY;

  if (idleMs === null ? !neverUsedYoung : idleMs > DAY) {
    return {
      status: 'fail',
      detail: idleMs === null ? 'The build token has never been used: the rebuild cron is not running.' : `The build token was last used ${Math.round(idleMs / HOUR)} hours ago: the rebuild cron is not running.`,
      remedy: 'Check the cron on the build server and that it reads the saved token.',
      data,
    };
  }
  if (idleMs === null || idleMs > 10 * MINUTE) {
    return {
      status: 'warn',
      detail: idleMs === null ? 'The build token has not been used yet.' : `The build token was last used ${minutes(idleMs)} minutes ago (the cron runs every few minutes).`,
      remedy: 'If this persists, check the rebuild cron on the build server.',
      data,
    };
  }
  if (expiresInDays < 14) {
    return {
      status: 'warn',
      detail: `The build token expires in ${Math.max(0, expiresInDays)} day(s).`,
      remedy: 'Create a new token for the build service user and replace the saved one before it expires.',
      data,
    };
  }
  return { status: 'pass', detail: `The build token is in use (last used ${minutes(idleMs)} minute(s) ago) and valid for ${expiresInDays} more days.`, data };
}

// ---------------------------------------------------------------------------
// site.build_freshness
// ---------------------------------------------------------------------------

export interface BuildFacts {
  contentVersion: string;
  lastPublishedAt: Date | null;
  lastBuildVersion: string | null;
  lastBuildStatus: string | null;
  lastBuildError: string | null;
}

/** Pass: the built version is the published one. Warn: out of step 5 to 15 min. Fail: over 15 min, or the last build failed. */
export function decideBuildFreshness(state: BuildFacts, now: number): DoctorCheckOutcome {
  if (state.lastBuildStatus === 'failed') {
    return {
      status: 'fail',
      detail: `The last site build failed: ${(state.lastBuildError ?? 'no error reported').slice(0, 200)}`,
      remedy: 'Open the build log on the build server, fix the cause and rebuild.',
      data: { lastBuildStatus: 'failed' },
    };
  }
  if (state.lastBuildVersion === state.contentVersion) {
    return { status: 'pass', detail: 'The website was built from the published content.', data: { inSync: true } };
  }
  const behindMs = state.lastPublishedAt ? Math.max(0, now - state.lastPublishedAt.getTime()) : 0;
  const data = { inSync: false, behindMinutes: minutes(behindMs) };
  if (behindMs > 15 * MINUTE) {
    return { status: 'fail', detail: `The website has been behind the published content for ${minutes(behindMs)} minutes.`, remedy: 'Check that the rebuild cron runs and reports its build status.', data };
  }
  if (behindMs >= 5 * MINUTE) {
    return { status: 'warn', detail: `The website is ${minutes(behindMs)} minutes behind the published content.`, remedy: 'It should catch up at the next rebuild; check the cron if it does not.', data };
  }
  return { status: 'pass', detail: 'A rebuild is pending (published less than 5 minutes ago).', data };
}

// ---------------------------------------------------------------------------
// projects.media_integrity
// ---------------------------------------------------------------------------

export interface PhotoFacts {
  id: string;
  isCover: boolean;
  /** The chosen master's object id (the original when nothing better exists). */
  masterObjectId: string | null;
  renditions: unknown;
}

const hasObject = (renditions: unknown, key: string): boolean => {
  const entry = (renditions && typeof renditions === 'object' ? (renditions as Record<string, unknown>)[key] : undefined) as { objectId?: unknown } | undefined;
  return typeof entry?.objectId === 'string' && entry.objectId.length > 0;
};

/** The ids of the photos missing a master, a card or hero crop, or (the cover) the branded OG. */
export function missingRenditions(photos: readonly PhotoFacts[], readyObjectIds?: ReadonlySet<string>): string[] {
  const missing: string[] = [];
  for (const photo of photos) {
    const objects = [photo.masterObjectId, ...['card4x3', 'hero16x9'].map((key) => ((photo.renditions as Record<string, { objectId?: string }> | null)?.[key]?.objectId ?? null))];
    const rowsOk = Boolean(photo.masterObjectId) && hasObject(photo.renditions, 'card4x3') && hasObject(photo.renditions, 'hero16x9') && (!photo.isCover || hasObject(photo.renditions, 'ogBranded'));
    const storedOk = !readyObjectIds || objects.every((id) => id && readyObjectIds.has(id));
    if (!rowsOk || !storedOk) missing.push(photo.id);
  }
  return missing;
}

export function decideMediaIntegrity(photoCount: number, missing: readonly string[]): DoctorCheckOutcome {
  if (photoCount === 0) return { status: 'skip', detail: 'No published project has photos yet.', data: { photos: 0 } };
  if (missing.length === 0) return { status: 'pass', detail: `All ${photoCount} photo(s) of published projects have their renditions.`, data: { photos: photoCount, missing: 0 } };
  return {
    status: 'fail',
    detail: `${missing.length} photo(s) of published projects are missing renditions (first ${Math.min(10, missing.length)}: ${missing.slice(0, 10).join(', ')}).`,
    remedy: 'Open the project and use "Reprocess" on those photos, or upload them again.',
    data: { photos: photoCount, missing: missing.length },
  };
}

// ---------------------------------------------------------------------------
// ai.projects_ready
// ---------------------------------------------------------------------------

export interface ModelFacts {
  capabilities: readonly string[];
  inputModalities: readonly string[];
}

/** The capability record an `ai_models` row stores (`{ capabilities, inputModalities }`), read defensively. */
export function readModelFacts(json: unknown): ModelFacts {
  const value = (json && typeof json === 'object' ? json : {}) as { capabilities?: unknown; inputModalities?: unknown };
  const list = (input: unknown): string[] => (Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []);
  return { capabilities: list(value.capabilities), inputModalities: list(value.inputModalities) };
}

/** Pass: AI on, a copy model (responses, structured output, image input) and an image-edit model. Warn: no retouch model. Fail: AI off or no copy model. */
export function decideAiReady(aiEnabled: boolean, models: readonly ModelFacts[]): DoctorCheckOutcome {
  if (!aiEnabled) {
    return { status: 'fail', detail: 'AI is switched off: project drafts and retouching are unavailable.', remedy: 'Switch AI on and enable a model in Admin, AI.', data: { aiEnabled: false } };
  }
  const copy = models.filter((model) => model.capabilities.includes('responses') && model.capabilities.includes('structured_output') && model.inputModalities.includes('image')).length;
  const retouch = models.filter((model) => model.capabilities.includes('image_edit')).length;
  const data = { aiEnabled: true, copyModels: copy, retouchModels: retouch };
  if (copy === 0) {
    return { status: 'fail', detail: 'No enabled model can draft project copy (it needs image input and structured output).', remedy: 'Enable a vision-capable model in Admin, AI, Models.', data };
  }
  if (retouch === 0) {
    return { status: 'warn', detail: 'Drafting is ready, but no image-editing model is enabled, so photo retouching is unavailable.', remedy: 'Enable an image-editing model in Admin, AI, Models.', data };
  }
  return { status: 'pass', detail: 'AI is on, with a model for project copy and one for retouching.', data };
}

// ---------------------------------------------------------------------------
// site.indexnow
// ---------------------------------------------------------------------------

export interface PingFacts {
  keyConfigured: boolean;
  lastPingStatus: string | null;
  lastPingError: string | null;
}

/** Pass: key set and the last ping was not refused. Warn: no key (or a retrying ping). Fail: the last ping was refused (403 or 422). */
export function decideIndexNow(facts: PingFacts): DoctorCheckOutcome {
  if (!facts.keyConfigured) {
    return { status: 'warn', detail: 'No IndexNow key is set: search engines are not told about changes.', remedy: 'Generate a key in Admin, Settings, Site publishing.', data: { keyConfigured: false } };
  }
  if (facts.lastPingStatus === 'config_error') {
    return {
      status: 'fail',
      detail: `The last IndexNow ping was refused: ${(facts.lastPingError ?? 'configuration error').slice(0, 200)}`,
      remedy: 'Check that the site serves the key file at its key location, then rebuild.',
      data: { keyConfigured: true, lastPingStatus: 'config_error' },
    };
  }
  if (facts.lastPingStatus === 'retrying') {
    return { status: 'warn', detail: 'The last IndexNow ping failed temporarily and is being retried.', data: { keyConfigured: true, lastPingStatus: 'retrying' } };
  }
  return {
    status: 'pass',
    detail: facts.lastPingStatus ? 'An IndexNow key is set and the last ping was accepted.' : 'An IndexNow key is set; no ping has been sent yet.',
    data: { keyConfigured: true, lastPingStatus: facts.lastPingStatus },
  };
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

abstract class ProjectsDoctorCheck implements DoctorCheck, OnModuleInit {
  abstract readonly id: string;
  readonly category = PROJECTS_DOCTOR_CATEGORY;
  abstract readonly label: string;
  readonly settingsPath: string = SITE_SETTINGS_PATH;

  protected constructor(protected readonly registry: DoctorCheckRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  abstract run(): Promise<DoctorCheckOutcome>;
}

@Injectable()
export class SiteContentTokenDoctorCheck extends ProjectsDoctorCheck {
  readonly id = 'site.content_token';
  readonly label = 'Website build token';

  constructor(registry: DoctorCheckRegistry, private readonly system: PrismaSystemService) {
    super(registry);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const tokens = await this.system.runAsSystem('doctor', (tx) =>
      tx.personalAccessToken.findMany({
        where: {
          revokedAt: null,
          user: { isActive: true, memberships: { some: { status: 'active', role: { rolePermissions: { some: { permission: { name: 'site_content:read' } } } } } } },
        },
        select: { expiresAt: true, createdAt: true, lastUsedAt: true },
      }),
    );
    return decideContentToken(tokens, Date.now());
  }
}

@Injectable()
export class SiteBuildFreshnessDoctorCheck extends ProjectsDoctorCheck {
  readonly id = 'site.build_freshness';
  readonly label = 'Website build freshness';

  constructor(registry: DoctorCheckRegistry, private readonly system: PrismaSystemService) {
    super(registry);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const states = await this.system.runAsSystem('doctor', (tx) =>
      tx.sitePublishState.findMany({ select: { contentVersion: true, lastPublishedAt: true, lastBuildVersion: true, lastBuildStatus: true, lastBuildError: true } }),
    );
    if (states.length === 0) return { status: 'skip', detail: 'Nothing has been published yet.' };
    const now = Date.now();
    return worst(states.map((state) => decideBuildFreshness(state, now)));
  }
}

@Injectable()
export class ProjectsMediaIntegrityDoctorCheck extends ProjectsDoctorCheck {
  readonly id = 'projects.media_integrity';
  readonly label = 'Published photo renditions';
  readonly settingsPath: string = '/projects';

  constructor(registry: DoctorCheckRegistry, private readonly system: PrismaSystemService) {
    super(registry);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const projects = await this.system.runAsSystem('doctor', (tx) =>
      tx.project.findMany({
        where: { status: 'published' },
        select: {
          coverPhotoId: true,
          photos: { select: { id: true, chosenVariant: true, originalObjectId: true, enhancedObjectId: true, retouchedObjectId: true, renditions: true } },
        },
      }),
    );
    const photos: PhotoFacts[] = projects.flatMap((project) =>
      project.photos.map((photo) => ({
        id: photo.id,
        isCover: photo.id === project.coverPhotoId,
        masterObjectId:
          photo.chosenVariant === 'retouched' && photo.retouchedObjectId
            ? photo.retouchedObjectId
            : photo.chosenVariant === 'enhanced' && photo.enhancedObjectId
              ? photo.enhancedObjectId
              : photo.originalObjectId,
        renditions: photo.renditions,
      })),
    );
    // Rows only: a storage_objects row in `ready` for every object the manifest would serve (no storage call).
    const wanted = new Set<string>();
    for (const photo of photos) {
      if (photo.masterObjectId) wanted.add(photo.masterObjectId);
      for (const key of ['card4x3', 'hero16x9']) {
        const id = (photo.renditions as Record<string, { objectId?: string }> | null)?.[key]?.objectId;
        if (id) wanted.add(id);
      }
    }
    const ready =
      wanted.size === 0
        ? new Set<string>()
        : new Set((await this.system.runAsSystem('doctor', (tx) => tx.storageObject.findMany({ where: { id: { in: [...wanted] }, status: 'ready' }, select: { id: true } }))).map((row) => row.id));
    return decideMediaIntegrity(photos.length, missingRenditions(photos, ready));
  }
}

@Injectable()
export class AiProjectsReadyDoctorCheck extends ProjectsDoctorCheck {
  readonly id = 'ai.projects_ready';
  readonly label = 'AI for projects';
  readonly settingsPath: string = '/admin/settings/ai';

  constructor(
    registry: DoctorCheckRegistry,
    private readonly system: PrismaSystemService,
    private readonly settings: SystemSettingsService,
  ) {
    super(registry);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const ai = (await this.settings.getNamespace('ai' as never)) as { enabled?: boolean };
    // Only what the platform's model discovery already stored: enabled, not deprecated models with their capabilities.
    const rows = await this.system.runAsSystem('doctor', (tx) => tx.aiModel.findMany({ where: { enabled: true, deprecatedAt: null }, select: { capabilities: true } }));
    return decideAiReady(ai.enabled === true, rows.map((row) => readModelFacts(row.capabilities)));
  }
}

@Injectable()
export class SiteIndexNowDoctorCheck extends ProjectsDoctorCheck {
  readonly id = 'site.indexnow';
  readonly label = 'IndexNow';

  constructor(
    registry: DoctorCheckRegistry,
    private readonly system: PrismaSystemService,
    private readonly credentials: CredentialsService,
  ) {
    super(registry);
  }

  async run(): Promise<DoctorCheckOutcome> {
    // The key's existence only (`describe`), never its value.
    const info = await this.credentials.describe(INDEXNOW_CREDENTIAL_PURPOSE, INDEXNOW_CREDENTIAL_NAME);
    const states = await this.system.runAsSystem('doctor', (tx) => tx.sitePublishState.findMany({ select: { lastPingStatus: true, lastPingError: true } }));
    const keyConfigured = info !== null && info !== undefined;
    if (states.length === 0) return decideIndexNow({ keyConfigured, lastPingStatus: null, lastPingError: null });
    return worst(states.map((state) => decideIndexNow({ keyConfigured, lastPingStatus: state.lastPingStatus, lastPingError: state.lastPingError })));
  }
}
