import { useCallback, useMemo, useState } from 'react';
import { usePlatformHost } from '@marinoscar/platform-web/core';
import { useSystemSettings } from '@marinoscar/platform-web/settings/headless';

import { describeError } from './api';
import { useProjectLiveUpdates } from './liveUpdates';
import { useProjectsClient, useResource } from './hooks';
import type { SiteStatus } from './types';

/** `GET/POST/DELETE /api/site/indexnow/key` (`projects:publish`). The key is public by design. */
export interface IndexNowKeyStatus {
  configured: boolean;
  key: string | null;
  keyLocation: string | null;
  updatedAt: string | null;
}

/** The `projects` system settings namespace (`projects.settings.schemas.ts`). */
export interface ProjectsSettings {
  brand: { navy: string; gold: string; businessName: string; phoneDisplay: string; logoObjectId: string | null };
  grade: { warmth: number; saturation: number };
  og: { enabled: boolean };
}
export interface ProjectsSettingsPatch {
  brand?: Partial<ProjectsSettings['brand']>;
  grade?: Partial<ProjectsSettings['grade']>;
  og?: Partial<ProjectsSettings['og']>;
}

/** The build status for the card; refreshes when a site build event arrives. */
export function useSitePublishStatus() {
  const client = useProjectsClient();
  const resource = useResource<SiteStatus>(() => client.siteStatus(), 'site-publishing-status');
  useProjectLiveUpdates(null, { active: false, refetch: resource.refetch });
  return resource;
}

export function useIndexNowKey() {
  const { api } = usePlatformHost();
  const resource = useResource<IndexNowKeyStatus>(() => api.get<IndexNowKeyStatus>('/site/indexnow/key'), 'indexnow-key');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (action: () => Promise<IndexNowKeyStatus | void>) => {
      setPending(true);
      setError(null);
      try {
        const next = await action();
        if (next) resource.setData(next);
        else await resource.refetch();
      } catch (e) {
        setError(describeError(e, 'Could not update the IndexNow key').message);
      } finally {
        setPending(false);
      }
    },
    [resource],
  );
  const generate = useCallback(() => run(() => api.post<IndexNowKeyStatus>('/site/indexnow/key')), [api, run]);
  const clear = useCallback(() => run(() => api.delete<void>('/site/indexnow/key')), [api, run]);
  return { ...resource, pending, actionError: error, generate, clear };
}

/** The `projects` namespace of `GET/PATCH /api/system-settings` (needs `system_settings:read` / `:write`). */
export function useProjectsSettings() {
  const settings = useSystemSettings<{ version: number; projects?: ProjectsSettings }>();
  const save = useCallback((patch: ProjectsSettingsPatch) => settings.updateSettings({ projects: patch } as never), [settings]);
  return useMemo(() => ({ ...settings, projects: settings.settings?.projects ?? null, save }), [settings, save]);
}
