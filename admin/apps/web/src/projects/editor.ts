import { useCallback, useEffect, useRef, useState } from 'react';

import { CHANGED_ELSEWHERE, describeError } from './api';
import { useProject, useProjectsClient } from './hooks';
import { useProjectLiveUpdates } from './liveUpdates';
import type { ApplyBody, Photo, PhotoRole, Project, ProjectSummary, RegenerateBody, RetouchOptions, UpdatePhotoPatch, UpdateProjectPatch } from './types';

/** The autosave debounce: edits are sent one second after the last keystroke. */
export const AUTOSAVE_DEBOUNCE_MS = 1000;

/** The editable fields of the form, as text inputs hold them. */
export interface Draft {
  title: string;
  slug: string;
  serviceSlug: string;
  townSlug: string;
  workNotes: string;
  summary: string;
  body: string;
  seoTitle: string;
  metaDescription: string;
  /** `YYYY-MM-DD`, or '' for none. */
  completedOn: string;
  featured: boolean;
}

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export function toDraft(project: ProjectSummary): Draft {
  return {
    title: project.title,
    slug: project.slug,
    serviceSlug: project.serviceSlug,
    townSlug: project.townSlug,
    workNotes: project.workNotes,
    summary: project.summary,
    body: project.body,
    seoTitle: project.seoTitle,
    metaDescription: project.metaDescription,
    completedOn: project.completedOn ?? '',
    featured: project.featured,
  };
}

/** The PATCH body for what differs between the form and the saved project. */
export function diffDraft(draft: Draft, saved: ProjectSummary): UpdateProjectPatch {
  const base = toDraft(saved);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as Array<keyof Draft>) {
    if (draft[key] === base[key]) continue;
    patch[key] = key === 'completedOn' && draft.completedOn === '' ? null : draft[key];
  }
  return patch as UpdateProjectPatch;
}

const PHOTO_TEXT_FIELDS = ['role', 'altText', 'caption', 'fileSlug', 'focalX', 'focalY', 'chosenVariant'] as const;
const PHOTO_PENDING_STATES = new Set(['pending', 'processing']);

/** Is any photo still being processed (so the page should poll)? */
export const photosProcessing = (photos: readonly Photo[]): boolean => photos.some((photo) => PHOTO_PENDING_STATES.has(photo.processingStatus));

/** Merges a fresh server photo list into the local one without clobbering text the user is typing. */
function mergePhotos(fresh: Photo[], local: Photo[], pending: ReadonlySet<string>): Photo[] {
  return fresh.map((photo) => {
    const mine = local.find((item) => item.id === photo.id);
    if (!mine || !pending.has(photo.id)) return photo;
    const keep: Partial<Photo> = {};
    for (const key of PHOTO_TEXT_FIELDS) (keep as Record<string, unknown>)[key] = mine[key];
    return { ...photo, ...keep };
  });
}

/**
 * The editor's state: the project, the form draft with its autosave (1 s debounce,
 * PATCH with If-Match; a 412 refetches and says so), photo edits, reorder, the AI
 * calls and the polling that follows background work.
 */
export function useProjectEditor(id: string) {
  const client = useProjectsClient();
  const resource = useProject(id);
  const project = resource.data;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [retouching, setRetouching] = useState<ReadonlySet<string>>(new Set());

  const projectRef = useRef<Project | undefined>(project);
  const draftRef = useRef<Draft | null>(draft);
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef(false);
  const rerun = useRef(false);
  const aiBaseline = useRef<string>('');
  const retouchBaseline = useRef(new Map<string, string>());
  const photoTimers = useRef(new Map<string, number>());
  const photoPatches = useRef(new Map<string, UpdatePhotoPatch>());
  projectRef.current = project;

  // The first load (and a reload) resets the form to the server's values.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (project && loadedFor.current !== `${project.id}`) {
      loadedFor.current = project.id;
      const next = toDraft(project);
      draftRef.current = next;
      setDraft(next);
      setSaveState('saved');
    }
  }, [project]);

  /** Reload everything and reset the form (after a conflict or an apply). */
  const reload = useCallback(async () => {
    window.clearTimeout(timer.current);
    const fresh = await client.get(id);
    resource.setData(fresh);
    projectRef.current = fresh;
    const next = toDraft(fresh);
    draftRef.current = next;
    setDraft(next);
    setSaveState('saved');
    setSaveError(null);
  }, [client, id, resource]);

  const handleConflict = useCallback(
    async (error: unknown): Promise<boolean> => {
      if (describeError(error).status !== 412) return false;
      await reload();
      setNotice(CHANGED_ELSEWHERE);
      return true;
    },
    [reload],
  );

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current);
    if (saving.current) {
      rerun.current = true;
      return;
    }
    const saved = projectRef.current;
    const current = draftRef.current;
    if (!saved || !current) return;
    const patch = diffDraft(current, saved);
    if (Object.keys(patch).length === 0) {
      setSaveState('saved');
      return;
    }
    saving.current = true;
    setSaveState('saving');
    try {
      const view = await client.update(saved.id, patch, saved.version);
      const merged = { ...(projectRef.current ?? saved), ...view } as Project;
      projectRef.current = merged;
      resource.setData(merged);
      setSaveError(null);
      setSaveState(Object.keys(diffDraft(draftRef.current ?? current, merged)).length === 0 ? 'saved' : 'unsaved');
    } catch (error) {
      if (!(await handleConflict(error))) {
        setSaveError(describeError(error, 'Could not save').message);
        setSaveState('error');
      }
    } finally {
      saving.current = false;
      if (rerun.current) {
        rerun.current = false;
        void flush();
      }
    }
  }, [client, handleConflict, resource]);

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS);
  }, [flush]);

  const setField = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) => {
      const next = { ...(draftRef.current as Draft), [key]: value };
      draftRef.current = next;
      setDraft(next);
      setSaveState('unsaved');
      schedule();
    },
    [schedule],
  );

  // Photo edits: local at once (so the live lint sees them), saved one second after the last change.
  const savePhoto = useCallback(
    async (photoId: string) => {
      const patch = photoPatches.current.get(photoId);
      photoPatches.current.delete(photoId);
      photoTimers.current.delete(photoId);
      if (!patch) return;
      try {
        const view = await client.updatePhoto(id, photoId, patch);
        resource.setData((prev) =>
          prev ? { ...prev, photos: prev.photos.map((photo) => (photo.id === photoId ? { ...photo, processingStatus: view.processingStatus, processingError: view.processingError ?? null } : photo)) } : prev,
        );
        setSaveError(null);
      } catch (error) {
        setSaveError(describeError(error, 'Could not save the photo').message);
      }
    },
    [client, id, resource],
  );

  const updatePhoto = useCallback(
    (photoId: string, patch: UpdatePhotoPatch, options: { immediate?: boolean } = {}) => {
      resource.setData((prev) => (prev ? { ...prev, photos: prev.photos.map((photo) => (photo.id === photoId ? { ...photo, ...patch } : photo)) } : prev));
      photoPatches.current.set(photoId, { ...photoPatches.current.get(photoId), ...patch });
      window.clearTimeout(photoTimers.current.get(photoId));
      if (options.immediate) {
        void savePhoto(photoId);
        return;
      }
      photoTimers.current.set(photoId, window.setTimeout(() => void savePhoto(photoId), AUTOSAVE_DEBOUNCE_MS));
    },
    [resource, savePhoto],
  );

  /** Flushes pending form and photo edits (before an apply or a publish). */
  const flushAll = useCallback(async () => {
    await flush();
    for (const photoId of [...photoPatches.current.keys()]) {
      window.clearTimeout(photoTimers.current.get(photoId));
      await savePhoto(photoId);
    }
  }, [flush, savePhoto]);

  // Best effort: send what is still pending when the page closes.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      const saved = projectRef.current;
      const current = draftRef.current;
      if (saved && current && Object.keys(diffDraft(current, saved)).length > 0) void client.update(saved.id, diffDraft(current, saved), saved.version).catch(() => undefined);
      for (const [photoId, handle] of photoTimers.current) {
        window.clearTimeout(handle);
        const patch = photoPatches.current.get(photoId);
        if (patch) void client.updatePhoto(id, photoId, patch).catch(() => undefined);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const addPhoto = useCallback(
    (photo: Photo) => {
      resource.setData((prev) => (prev && !prev.photos.some((item) => item.id === photo.id) ? { ...prev, photos: [...prev.photos, { previews: {}, ...photo }] } : prev));
    },
    [resource],
  );

  const removePhoto = useCallback(
    async (photoId: string) => {
      await client.removePhoto(id, photoId);
      resource.setData((prev) =>
        prev ? { ...prev, photos: prev.photos.filter((photo) => photo.id !== photoId), coverPhotoId: prev.coverPhotoId === photoId ? null : prev.coverPhotoId } : prev,
      );
    },
    [client, id, resource],
  );

  const reorderPhotos = useCallback(
    async (photoIds: string[]) => {
      const before = projectRef.current?.photos ?? [];
      resource.setData((prev) => (prev ? { ...prev, photos: photoIds.map((photoId) => prev.photos.find((photo) => photo.id === photoId)!).filter(Boolean) } : prev));
      try {
        await client.reorderPhotos(id, photoIds);
      } catch (error) {
        resource.setData((prev) => (prev ? { ...prev, photos: before } : prev));
        setSaveError(describeError(error, 'Could not reorder the photos').message);
      }
    },
    [client, id, resource],
  );

  const setCover = useCallback(
    (photoId: string) => {
      resource.setData((prev) => (prev ? { ...prev, coverPhotoId: photoId } : prev));
      void client
        .update(id, { coverPhotoId: photoId }, projectRef.current?.version ?? 0)
        .then((view) => {
          const merged = { ...(projectRef.current as Project), ...view };
          projectRef.current = merged;
          resource.setData(merged);
        })
        .catch(async (error: unknown) => {
          if (!(await handleConflict(error))) setSaveError(describeError(error, 'Could not set the cover').message);
        });
    },
    [client, handleConflict, id, resource],
  );

  const retryPhoto = useCallback(
    async (photoId: string) => {
      try {
        const updated = await client.retryPhoto(id, photoId);
        resource.setData((prev) =>
          prev
            ? {
                ...prev,
                photos: prev.photos.map((photo) =>
                  photo.id === photoId ? { ...photo, ...(updated ?? {}), processingStatus: updated?.processingStatus ?? 'pending', processingError: null } : photo,
                ),
              }
            : prev,
        );
      } catch (error) {
        setSaveError(describeError(error, 'Could not retry the photo').message);
      }
    },
    [client, id, resource],
  );

  // ----- AI -----
  const suggestionKey = (p: Project | undefined) => JSON.stringify([p?.aiSuggestion ?? null, p?.photos.map((photo) => photo.aiSuggestion ?? null)]);

  const suggest = useCallback(async () => {
    setAiError(null);
    await flushAll();
    aiBaseline.current = suggestionKey(projectRef.current);
    setAiPending(true);
    try {
      await client.suggest(id, {});
    } catch (error) {
      setAiPending(false);
      setAiError(describeError(error, 'Could not start the AI suggestion').message);
    }
  }, [client, flushAll, id]);

  const regenerate = useCallback(
    async (body: RegenerateBody) => {
      setAiError(null);
      aiBaseline.current = suggestionKey(projectRef.current);
      setAiPending(true);
      try {
        await client.regenerate(id, body);
      } catch (error) {
        setAiPending(false);
        setAiError(describeError(error, 'Could not ask for another option').message);
      }
    },
    [client, id],
  );

  const apply = useCallback(
    async (body: ApplyBody) => {
      setAiError(null);
      await flushAll();
      try {
        await client.apply(id, body, projectRef.current?.version ?? 0);
        await reload();
      } catch (error) {
        if (!(await handleConflict(error))) setAiError(describeError(error, 'Could not apply the suggestion').message);
      }
    },
    [client, flushAll, handleConflict, id, reload],
  );

  const retouch = useCallback(
    async (photoId: string, options: RetouchOptions = { declutter: true, evenLighting: true, straighten: true }) => {
      const photo = projectRef.current?.photos.find((item) => item.id === photoId);
      retouchBaseline.current.set(photoId, photo?.retouchedObjectId ?? '');
      setRetouching((prev) => new Set(prev).add(photoId));
      try {
        await client.retouch(id, photoId, options);
      } catch (error) {
        setRetouching((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
        setSaveError(describeError(error, 'Could not start the retouch').message);
      }
    },
    [client, id],
  );

  // Pending flags clear when the thing they wait for shows up.
  useEffect(() => {
    if (aiPending && suggestionKey(project) !== aiBaseline.current) setAiPending(false);
    if (retouching.size > 0 && project) {
      const done = [...retouching].filter((photoId) => (project.photos.find((photo) => photo.id === photoId)?.retouchedObjectId ?? '') !== (retouchBaseline.current.get(photoId) ?? ''));
      if (done.length > 0) setRetouching((prev) => new Set([...prev].filter((photoId) => !done.includes(photoId))));
    }
  }, [project, aiPending, retouching]);

  // Polling fallback (#39 replaces it with server events): photos processing, an AI job, a retouch.
  const poll = useCallback(async () => {
    try {
      const fresh = await client.get(id);
      const pending = new Set(photoPatches.current.keys());
      resource.setData((prev) => (prev ? { ...prev, aiSuggestion: fresh.aiSuggestion ?? null, lint: fresh.lint, photos: mergePhotos(fresh.photos, prev.photos, pending) } : fresh));
    } catch {
      /* the next tick retries */
    }
  }, [client, id, resource]);
  const active = aiPending || retouching.size > 0 || photosProcessing(project?.photos ?? []);
  useProjectLiveUpdates(id, {
    active,
    refetch: poll,
    onTimeout: () => {
      setAiPending(false);
      setRetouching(new Set());
    },
  });

  return {
    project,
    loading: resource.loading,
    error: resource.error,
    draft,
    setField,
    saveState,
    saveError,
    notice,
    dismissNotice: () => setNotice(null),
    flushAll,
    getVersion: () => projectRef.current?.version ?? 0,
    reload,
    handleConflict,
    setProject: resource.setData,
    updatePhoto,
    addPhoto,
    removePhoto,
    reorderPhotos,
    setCover,
    retryPhoto,
    retouch,
    retouching,
    suggest,
    regenerate,
    apply,
    aiPending,
    aiError,
    clearAiError: () => setAiError(null),
  };
}

export type ProjectEditor = ReturnType<typeof useProjectEditor>;

export const ROLE_LABELS: Record<PhotoRole, string> = { before: 'Before', after: 'After', progress: 'Progress', detail: 'Detail' };
