import type { StorageObject, StorageObjectsClient } from '@marinoscar/platform-web/storage/headless';

/** Files above this size use the resumable multipart upload; smaller ones one simple request. */
export const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;
/** At most this many files upload at once. */
export const MAX_CONCURRENT_UPLOADS = 3;
/** The message the API gives a HEIC photo (#16), shown before the round trip too. */
export const HEIC_MESSAGE = 'HEIC not supported — set iPhone Camera ▸ Formats ▸ Most Compatible, or share as JPEG';

const PART_URL_BATCH = 100;

export function isHeic(file: Pick<File, 'name' | 'type'>): boolean {
  return /^image\/hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** PUTs one part to its URL and returns the part's ETag. Injectable so tests need no network. */
export type PutPart = (url: string, body: Blob, options: { bearerToken: string | null }) => Promise<string>;

export const fetchPutPart: PutPart = async (url, body, { bearerToken }) => {
  const response = await fetch(url, { method: 'PUT', body, ...(bearerToken ? { headers: { Authorization: `Bearer ${bearerToken}` } } : {}) });
  if (!response.ok) throw new Error(`Part upload failed (${response.status})`);
  const eTag = response.headers.get('ETag');
  if (!eTag) throw new Error('The storage service did not return an ETag for the part');
  return eTag;
};

export interface UploadDeps {
  storage: StorageObjectsClient;
  putPart?: PutPart;
  /** The bearer credential for storage drivers that take parts through the API (`partUploadAuth: 'bearer'`). */
  getAccessToken?: () => string | null;
}

/** What a resume needs: the object, the part size and the ETags of the parts already stored. */
export interface ResumeState {
  objectId: string;
  partSize: number;
  totalParts: number;
  eTags: Record<number, string>;
}

export interface UploadCallbacks {
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  /** Called whenever the resume state changes, so a failed upload can continue where it stopped. */
  onState?: (state: ResumeState) => void;
  signal?: AbortSignal;
}

async function ready(storage: StorageObjectsClient, object: StorageObject): Promise<StorageObject> {
  return object.status === 'ready' ? object : storage.waitForReady(object);
}

/**
 * Uploads one file with the platform storage client: a simple upload up to 5 MB,
 * otherwise `upload/init` -> `part-urls` -> PUT each part -> `complete`. Given the
 * `resume` state of an earlier failed attempt it asks `upload/status`, skips the
 * parts the storage backend already holds (and whose ETags it kept) and sends the
 * rest. Resolves to the ready storage object id.
 */
export async function uploadFile(file: File, deps: UploadDeps, callbacks: UploadCallbacks = {}, resume?: ResumeState): Promise<string> {
  const { storage, putPart = fetchPutPart, getAccessToken = () => null } = deps;
  const { onProgress, onState, signal } = callbacks;

  if (file.size <= RESUMABLE_THRESHOLD_BYTES) {
    onProgress?.(0);
    const object = await ready(storage, await storage.upload(file, file.name));
    onProgress?.(1);
    return object.id;
  }

  let state: ResumeState;
  let auth: 'none' | 'bearer';
  let urls = new Map<number, string>();
  if (resume) {
    state = { ...resume, eTags: { ...resume.eTags } };
    const status = await storage.uploadStatus(state.objectId);
    const held = new Set(status.uploadedParts);
    // A part is only reusable when the backend holds it AND we kept its ETag.
    for (const part of Object.keys(state.eTags).map(Number)) if (!held.has(part)) delete state.eTags[part];
    auth = 'none';
    const missing = Array.from({ length: state.totalParts }, (_, index) => index + 1).filter((part) => state.eTags[part] === undefined);
    ({ urls, auth } = await requestUrls(storage, state.objectId, missing));
  } else {
    const init = await storage.initUpload({ name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream' });
    state = { objectId: init.objectId, partSize: init.partSize, totalParts: init.totalParts, eTags: {} };
    auth = init.partUploadAuth;
    urls = new Map(init.presignedUrls.map((part) => [part.partNumber, part.url]));
    const rest = Array.from({ length: init.totalParts }, (_, index) => index + 1).filter((part) => !urls.has(part));
    const more = await requestUrls(storage, state.objectId, rest);
    for (const [part, url] of more.urls) urls.set(part, url);
    if (more.urls.size > 0) auth = more.auth;
  }
  onState?.(state);

  const report = () => onProgress?.(Math.min(1, Object.keys(state.eTags).length / state.totalParts));
  report();
  for (let part = 1; part <= state.totalParts; part++) {
    if (state.eTags[part] !== undefined) continue;
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    const url = urls.get(part);
    if (!url) throw new Error(`No upload URL for part ${part}`);
    const body = file.slice((part - 1) * state.partSize, part * state.partSize);
    state.eTags[part] = await putPart(url, body, { bearerToken: auth === 'bearer' ? getAccessToken() : null });
    onState?.({ ...state, eTags: { ...state.eTags } });
    report();
  }

  const parts = Array.from({ length: state.totalParts }, (_, index) => ({ partNumber: index + 1, eTag: state.eTags[index + 1]! }));
  const object = await ready(storage, await storage.completeUpload(state.objectId, { parts }));
  onProgress?.(1);
  return object.id;
}

async function requestUrls(storage: StorageObjectsClient, objectId: string, partNumbers: number[]): Promise<{ urls: Map<number, string>; auth: 'none' | 'bearer' }> {
  const urls = new Map<number, string>();
  let auth: 'none' | 'bearer' = 'none';
  for (let index = 0; index < partNumbers.length; index += PART_URL_BATCH) {
    const response = await storage.partUrls(objectId, { partNumbers: partNumbers.slice(index, index + PART_URL_BATCH) });
    auth = response.partUploadAuth;
    for (const part of response.presignedUrls) urls.set(part.partNumber, part.url);
  }
  return { urls, auth };
}
