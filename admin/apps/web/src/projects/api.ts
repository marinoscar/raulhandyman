import type { PlatformApiClient } from '@marinoscar/platform-web/core';

import type {
  ApplyBody,
  Catalog,
  CreateProjectInput,
  Photo,
  PhotoRole,
  Project,
  ProjectFilters,
  ProjectList,
  ProjectSummary,
  PublishResult,
  RegenerateBody,
  RetouchOptions,
  SiteStatus,
  UpdatePhotoPatch,
  UpdateProjectPatch,
} from './types';

/** The `If-Match` value for a project version (the API accepts the bare number). */
const ifMatch = (version: number): { ifMatch: string } => ({ ifMatch: String(version) });
/** The same header for a POST (the platform test host records `ifMatch` only for PUT, PATCH and DELETE; the real transport sends both alike). */
const ifMatchHeader = (version: number): { headers: Record<string, string> } => ({ headers: { 'If-Match': String(version) } });

/** `GET /projects?...` with only the filters that are set. */
export function projectsQuery(filters: ProjectFilters): string {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.service) query.set('service', filters.service);
  if (filters.q?.trim()) query.set('q', filters.q.trim());
  query.set('page', String(filters.page));
  query.set('pageSize', String(filters.pageSize));
  return query.toString();
}

/** A typed client over the host API for every projects route (#14, #15, #20, #21, #22, #28). */
export function createProjectsClient(api: PlatformApiClient) {
  const base = (id: string) => `/projects/${encodeURIComponent(id)}`;
  return {
    list: (filters: ProjectFilters, signal?: AbortSignal) => api.get<ProjectList>(`/projects?${projectsQuery(filters)}`, signal ? { signal } : undefined),
    catalog: () => api.get<Catalog>('/projects/catalog'),
    get: (id: string) => api.get<Project>(base(id)),
    create: (input: CreateProjectInput) => api.post<ProjectSummary>('/projects', input),
    update: (id: string, patch: UpdateProjectPatch, version: number) => api.patch<ProjectSummary>(base(id), patch, ifMatch(version)),
    remove: (id: string) => api.delete<void>(base(id)),
    publish: (id: string, version: number) => api.post<PublishResult>(`${base(id)}/publish`, undefined, ifMatchHeader(version)),
    unpublish: (id: string, version: number) => api.post<PublishResult>(`${base(id)}/unpublish`, undefined, ifMatchHeader(version)),

    addPhoto: (id: string, storageObjectId: string, role?: PhotoRole) =>
      api.post<Photo>(`${base(id)}/photos`, role ? { storageObjectId, role } : { storageObjectId }),
    /** The FULL set of the project's photo ids, in the new order. */
    reorderPhotos: (id: string, photoIds: string[]) => api.post<unknown>(`${base(id)}/photos/reorder`, { photoIds }),
    updatePhoto: (id: string, photoId: string, patch: UpdatePhotoPatch) => api.patch<Photo>(`${base(id)}/photos/${encodeURIComponent(photoId)}`, patch),
    removePhoto: (id: string, photoId: string) => api.delete<void>(`${base(id)}/photos/${encodeURIComponent(photoId)}`),
    /** Re-runs processing of a failed photo. */
    retryPhoto: (id: string, photoId: string) => api.post<Photo>(`${base(id)}/photos/${encodeURIComponent(photoId)}/reprocess`),
    retouch: (id: string, photoId: string, options: RetouchOptions) =>
      api.post<{ jobId: string }>(`${base(id)}/photos/${encodeURIComponent(photoId)}/retouch`, { options }),

    suggest: (id: string, body: { fields?: Array<'project' | 'photos'>; photoIds?: string[] } = {}) => api.post<{ jobId: string }>(`${base(id)}/ai/suggest`, body),
    apply: (id: string, body: ApplyBody, version: number) => api.post<ProjectSummary>(`${base(id)}/ai/apply`, body, ifMatchHeader(version)),
    regenerate: (id: string, body: RegenerateBody) => api.post<{ jobId: string }>(`${base(id)}/ai/regenerate`, body),

    siteStatus: () => api.get<SiteStatus>('/site/status'),
    aiConfig: () => api.get<{ enabled: boolean }>('/ai/config'),
  };
}

export type ProjectsClient = ReturnType<typeof createProjectsClient>;

/** A readable message and the HTTP status of a failed call. */
export function describeError(error: unknown, fallback = 'Something went wrong'): { status?: number; message: string; details?: unknown } {
  if (error && typeof error === 'object') {
    const { status, message, details } = error as { status?: unknown; message?: unknown; details?: unknown };
    return {
      ...(typeof status === 'number' ? { status } : {}),
      message: typeof message === 'string' && message ? message : fallback,
      ...(details === undefined ? {} : { details }),
    };
  }
  return { message: fallback };
}

export const CHANGED_ELSEWHERE = 'This project changed on another device — reloaded';
