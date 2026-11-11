import type { LintResult } from '@app/shared/seo-lint';

export type { LintIssue, LintResult } from '@app/shared/seo-lint';

export type ProjectStatus = 'draft' | 'published' | 'archived';
export type PhotoRole = 'before' | 'after' | 'progress' | 'detail';
export type PhotoVariant = 'original' | 'enhanced' | 'retouched';
export type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';

/** `GET /api/projects/catalog`. */
export interface Catalog {
  version: number;
  services: Array<{ slug: string; name: string; seoName: string; tag: string }>;
  towns: Array<{ slug: string; name: string; core: boolean }>;
}

/** The AI output of issue #20 (`projects-copy.schema.ts`), stored as `{ model, createdAt, runId, output }`. */
export interface ProjectCopyOutput {
  titleOptions: string[];
  slug: string;
  seoTitle: string;
  metaDescription: string;
  summary: string;
  body: string;
  photos?: Array<{ photoId: string; altText: string; caption: string; fileSlug: string; suggestedRole: PhotoRole; privacyFlags: string[] }>;
  warnings: string[];
}

export interface AiSuggestionEnvelope<T> {
  model?: string;
  createdAt?: string;
  runId?: string;
  promptVersion?: string;
  output: T;
  lintWarnings?: { code: string; field: string; message: string; photoId?: string }[];
}

export interface PhotoCopyOutput {
  altText?: string;
  caption?: string;
  fileSlug?: string;
  suggestedRole?: PhotoRole;
  privacyFlags?: string[];
}

/** The signed preview URLs of a photo, by rendition name (`thumb`, `card4x3`, `hero16x9`, `og`, `ogBranded`, `original`, ...). */
export type PhotoPreviews = Partial<Record<string, string | null>>;

export interface Photo {
  id: string;
  projectId: string;
  sortOrder: number;
  role: PhotoRole;
  originalObjectId: string | null;
  enhancedObjectId: string | null;
  retouchedObjectId: string | null;
  chosenVariant: PhotoVariant;
  focalX: number;
  focalY: number;
  width: number | null;
  height: number | null;
  altText: string;
  caption: string;
  fileSlug: string;
  qualityFlags: string[];
  privacyFlags: string[];
  processingStatus: ProcessingStatus;
  processingError: string | null;
  aiRetouched?: boolean;
  /** The suggestion of issue #20; either the envelope or the bare output is accepted. */
  aiSuggestion?: AiSuggestionEnvelope<PhotoCopyOutput> | PhotoCopyOutput | null;
  previews?: PhotoPreviews;
}

/** A project as the list returns it (`toProjectView`, plus the optional list extras). */
export interface ProjectSummary {
  id: string;
  slug: string;
  previousSlugs: string[];
  status: ProjectStatus;
  title: string;
  serviceSlug: string;
  townSlug: string;
  workNotes: string;
  summary: string;
  body: string;
  seoTitle: string;
  metaDescription: string;
  completedOn: string | null;
  featured: boolean;
  coverPhotoId: string | null;
  publishedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Optional list extras: a signed `thumb` URL of the cover and the number of SEO errors. */
  coverThumbUrl?: string | null;
  lintErrorCount?: number | null;
}

/** `GET /api/projects/:id`. */
export interface Project extends ProjectSummary {
  photos: Photo[];
  lint?: LintResult;
  aiSuggestion?: AiSuggestionEnvelope<ProjectCopyOutput> | null;
}

export interface ProjectList {
  items: ProjectSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProjectFilters {
  status?: ProjectStatus | '';
  service?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export interface CreateProjectInput {
  serviceSlug: string;
  townSlug: string;
  workNotes?: string;
}

export type UpdateProjectPatch = Partial<{
  title: string;
  slug: string;
  serviceSlug: string;
  townSlug: string;
  workNotes: string;
  summary: string;
  body: string;
  seoTitle: string;
  metaDescription: string;
  completedOn: string | null;
  featured: boolean;
  coverPhotoId: string | null;
  status: 'draft' | 'archived';
}>;

export type UpdatePhotoPatch = Partial<{
  role: PhotoRole;
  altText: string;
  caption: string;
  fileSlug: string;
  focalX: number;
  focalY: number;
  chosenVariant: PhotoVariant;
}>;

export type ApplyProjectField = 'title' | 'slug' | 'seoTitle' | 'metaDescription' | 'summary' | 'body';
export type ApplyPhotoField = 'altText' | 'caption' | 'fileSlug' | 'role';

export interface ApplyBody {
  project?: ApplyProjectField[];
  titleOption?: 0 | 1 | 2;
  photos?: Array<{ photoId: string; fields: ApplyPhotoField[] }>;
}

export type RegenerateBody = { field: 'title' | 'seoTitle' | 'metaDescription' | 'summary' | 'body' } | { photoId: string; field: 'altText' | 'caption' };

export interface RetouchOptions {
  declutter: boolean;
  evenLighting: boolean;
  straighten: boolean;
}

/** `GET /api/site/status` (#28). */
export interface SiteStatus {
  contentVersion: string | null;
  lastBuildVersion: string | null;
  lastBuildAt: string | null;
  lastBuildStatus: 'success' | 'failed' | 'running' | 'pending' | string | null;
  lastBuildError: string | null;
  /** The last IndexNow ping (`GET /api/site/status`). */
  lastPing?: { at: string | null; status: string | number | null; error: string | null; urlCount: number | null };
}

/** `POST .../publish` and `.../unpublish`: the project view plus the new content version (and the lint on publish). */
export type PublishResult = ProjectSummary & { contentVersion: string; lint?: LintResult };
