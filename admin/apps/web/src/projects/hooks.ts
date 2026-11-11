import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlatformHost } from '@marinoscar/platform-web/core';
import { createStorageObjectsClient } from '@marinoscar/platform-web/storage/headless';

import { api as httpApi } from '../api';
import { createProjectsClient, describeError, type ProjectsClient } from './api';
import { useProjectLiveUpdates } from './liveUpdates';
import type { Catalog, CreateProjectInput, Project, ProjectFilters, ProjectList, ProjectSummary, SiteStatus } from './types';
import type { UploadDeps } from './upload';

/** The typed client over the host API (stable for the host's lifetime). */
export function useProjectsClient(): ProjectsClient {
  const { api } = usePlatformHost();
  return useMemo(() => createProjectsClient(api), [api]);
}

export interface Resource<T> {
  data: T | undefined;
  loading: boolean;
  error: { status?: number; message: string } | null;
  refetch: () => Promise<void>;
  setData: (next: T | undefined | ((prev: T | undefined) => T | undefined)) => void;
}

/** A tiny fetch-on-change resource: the latest request wins; a refetch keeps the old data while it loads. */
export function useResource<T>(load: (() => Promise<T>) | null, key: string): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(load !== null);
  const [error, setError] = useState<Resource<T>['error']>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const refetch = useCallback(async () => {
    const run = loadRef.current;
    if (!run) return;
    const mine = ++seq.current;
    try {
      const next = await run();
      if (mine !== seq.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      const { status, message } = describeError(e, 'Could not load');
      setError({ ...(status === undefined ? {} : { status }), message });
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  const enabled = load !== null;
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void refetch();
    return () => {
      seq.current++;
    };
  }, [key, enabled, refetch]);

  return { data, loading, error, refetch, setData };
}

/** `GET /api/projects` for the filters; the previous page stays visible while the next loads. */
export function useProjects(filters: ProjectFilters): Resource<ProjectList> {
  const client = useProjectsClient();
  return useResource(() => client.list(filters), JSON.stringify(filters));
}

/** `GET /api/projects/:id` (with photos, signed previews and lint). */
export function useProject(id: string): Resource<Project> {
  const client = useProjectsClient();
  return useResource(() => client.get(id), id);
}

/** The service and town catalog (rarely changes: one fetch per page). */
export function useCatalog(): Resource<Catalog> {
  const client = useProjectsClient();
  return useResource(() => client.catalog(), 'catalog');
}

/** Creates a draft project; resolves to it. */
export function useCreateProject() {
  const client = useProjectsClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useCallback(
    async (input: CreateProjectInput): Promise<ProjectSummary | null> => {
      setPending(true);
      setError(null);
      try {
        return await client.create(input);
      } catch (e) {
        setError(describeError(e, 'Could not create the project').message);
        return null;
      } finally {
        setPending(false);
      }
    },
    [client],
  );
  return { create, pending, error };
}

/** Whether AI is on (`GET /api/ai/config`) and the viewer may use it (`ai:use`), with the reason when not. */
export function useAiAvailability(): { available: boolean; reason: string | null } {
  const { viewer } = usePlatformHost();
  const client = useProjectsClient();
  const permitted = viewer.hasPermission('ai:use');
  const config = useResource(permitted ? () => client.aiConfig() : null, 'ai-config');
  if (!permitted) return { available: false, reason: "You don't have permission to use AI" };
  if (config.data === undefined) return { available: false, reason: config.error ? 'AI is not available' : 'Checking whether AI is on…' };
  if (!config.data.enabled) return { available: false, reason: 'AI is turned off. An administrator can turn it on in Administration.' };
  return { available: true, reason: null };
}

/** `GET /api/site/status`, polled while a build is pending (see liveUpdates.ts). */
export function useSiteStatus(enabled: boolean) {
  const client = useProjectsClient();
  const resource = useResource<SiteStatus | null>(
    enabled ? () => client.siteStatus().catch((e: unknown) => (describeError(e).status === 404 ? null : Promise.reject(e))) : null,
    'site-status',
  );
  const status = resource.data ?? null;
  const live = status !== null && status.lastBuildVersion === status.contentVersion;
  const failed = !live && status?.lastBuildStatus === 'failed';
  useProjectLiveUpdates(null, { active: enabled && status !== null && !live && !failed, refetch: resource.refetch });
  return { status, live, failed, refresh: resource.refetch };
}

/** The platform storage client plus the part uploader the photo uploader needs. */
export function useUploadDeps(): UploadDeps {
  const { api } = usePlatformHost();
  return useMemo(
    () => ({
      storage: createStorageObjectsClient(api),
      getAccessToken: () => httpApi.getAccessToken(),
    }),
    [api],
  );
}
