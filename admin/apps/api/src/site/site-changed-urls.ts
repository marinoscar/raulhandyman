import { createHash } from 'node:crypto';

import { canonicalJson } from '../projects/site-content-version';
import type { SiteManifest } from './site-manifest.schema';

/** The public origin pinged to IndexNow. The host is fixed here, never taken from input. */
export const SITE_HOST = 'raulhandyman.net';
export const SITE_ORIGIN = `https://${SITE_HOST}`;

/** A per-project fingerprint of what the site renders from the manifest. */
export interface PingProjectFingerprint {
  id: string;
  slug: string;
  serviceSlug: string;
  hash: string;
}

/**
 * What the last ping covered. Stored in `SitePublishState.pingSnapshot` and diffed
 * by the next ping job, which is how "changed since the previous manifest" is
 * answered without keeping old manifests around.
 */
export interface PingSnapshot {
  contentVersion: string;
  projects: PingProjectFingerprint[];
}

/** Fingerprints a manifest. `updatedAt` is excluded: only rendered content counts. */
export function snapshotOf(manifest: Pick<SiteManifest, 'contentVersion' | 'projects'>): PingSnapshot {
  return {
    contentVersion: manifest.contentVersion,
    projects: manifest.projects
      .map((project) => {
        const { updatedAt: _updatedAt, ...rendered } = project;
        return {
          id: project.id,
          slug: project.slug,
          serviceSlug: project.serviceSlug,
          hash: createHash('sha256').update(canonicalJson(rendered)).digest('hex'),
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/** Reads a stored snapshot defensively (it is JSON in the database); anything malformed is "no previous ping". */
export function parseSnapshot(value: unknown): PingSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { contentVersion?: unknown; projects?: unknown };
  if (typeof raw.contentVersion !== 'string' || !Array.isArray(raw.projects)) return null;
  const projects: PingProjectFingerprint[] = [];
  for (const item of raw.projects as Array<Record<string, unknown>>) {
    if (typeof item?.id !== 'string' || typeof item.slug !== 'string' || typeof item.serviceSlug !== 'string' || typeof item.hash !== 'string') return null;
    projects.push({ id: item.id, slug: item.slug, serviceSlug: item.serviceSlug, hash: item.hash });
  }
  return { contentVersion: raw.contentVersion, projects };
}

/**
 * The site paths whose HTML changed between two published states: the project
 * pages that were published, unpublished (or renamed) or edited, the pages of the
 * services they belong to, and the two listings that show every project (`/projects/`
 * and `/`). Nothing changed means no URLs. `previous` null is the first ping:
 * every published project counts as new. Paths are absolute ("/projects/x/"),
 * sorted and unique.
 */
export function changedPaths(previous: PingSnapshot | null, next: PingSnapshot): string[] {
  const before = new Map((previous?.projects ?? []).map((project) => [project.id, project]));
  const after = new Map(next.projects.map((project) => [project.id, project]));
  const paths = new Set<string>();
  const touch = (project: PingProjectFingerprint) => {
    paths.add(`/projects/${project.slug}/`);
    paths.add(`/${project.serviceSlug}/`);
  };

  for (const project of next.projects) {
    const old = before.get(project.id);
    if (!old) touch(project);
    else if (old.hash !== project.hash || old.slug !== project.slug || old.serviceSlug !== project.serviceSlug) {
      touch(project);
      touch(old);
    }
  }
  for (const old of before.values()) if (!after.has(old.id)) touch(old);

  if (paths.size > 0) {
    paths.add('/projects/');
    paths.add('/');
  }
  return [...paths].sort();
}

/** Absolute URLs for the paths. */
export const toUrls = (paths: readonly string[]): string[] => paths.map((path) => `${SITE_ORIGIN}${path}`);
