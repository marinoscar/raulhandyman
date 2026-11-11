import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import { createTestPlatformHost, type TestApiRequest, type TestPlatformHostOptions } from '@marinoscar/platform-web/testing';

import type { Catalog, Photo, Project, ProjectSummary } from '../../projects/types';

export const catalog: Catalog = {
  version: 1,
  services: [
    { slug: 'painting', name: 'Interior & exterior painting', seoName: 'Interior & Exterior Painting', tag: 'Paint' },
    { slug: 'drywall-repair', name: 'Drywall repair', seoName: 'Drywall Repair', tag: 'Walls' },
  ],
  towns: [
    { slug: 'town-alpha', name: 'Town Alpha', core: true },
    { slug: 'town-beta', name: 'Town Beta', core: false },
  ],
};

export const ID = '11111111-1111-4111-8111-111111111111';
export const P1 = '22222222-2222-4222-8222-222222222221';
export const P2 = '22222222-2222-4222-8222-222222222222';
export const P3 = '22222222-2222-4222-8222-222222222223';

export function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: ID,
    slug: 'wall-repair-town-alpha',
    previousSlugs: [],
    status: 'draft',
    title: 'Wall repair in Town Alpha',
    serviceSlug: 'drywall-repair',
    townSlug: 'town-alpha',
    workNotes: 'Patched a hole.',
    summary: '',
    body: '',
    seoTitle: '',
    metaDescription: '',
    completedOn: null,
    featured: false,
    coverPhotoId: null,
    publishedAt: null,
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

export function photo(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    projectId: ID,
    sortOrder: 0,
    role: 'after',
    originalObjectId: `obj-${id}`,
    enhancedObjectId: `enh-${id}`,
    retouchedObjectId: null,
    chosenVariant: 'enhanced',
    focalX: 0.5,
    focalY: 0.5,
    width: 4000,
    height: 3000,
    altText: '',
    caption: '',
    fileSlug: '',
    qualityFlags: [],
    privacyFlags: [],
    processingStatus: 'ready',
    processingError: null,
    previews: {
      thumb: `https://img.example.test/${id}/thumb.webp`,
      original: `https://img.example.test/${id}/original.jpg`,
      enhanced: `https://img.example.test/${id}/enhanced.jpg`,
      card4x3: `https://img.example.test/${id}/card.jpg`,
      hero16x9: `https://img.example.test/${id}/hero.jpg`,
      ogBranded: `https://img.example.test/${id}/og.jpg`,
    },
    ...overrides,
  };
}

export function project(overrides: Partial<Project> = {}): Project {
  return { ...summary(), photos: [], lint: { errors: [], warnings: [], score: 100 }, aiSuggestion: null, ...overrides } as Project;
}

type Responses = NonNullable<TestPlatformHostOptions['responses']>;

/** Renders `ui` inside a router and a test platform host; `route` is where the page is mounted. */
export function renderWithHost(ui: ReactElement, options: TestPlatformHostOptions & { route?: string; path?: string } = {}) {
  const { route = '/', path = '/', ...hostOptions } = options;
  const host = createTestPlatformHost(hostOptions);
  const view = render(
    <PlatformHostProvider host={host}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </PlatformHostProvider>,
  );
  return { host, ...view };
}

export const calls = (host: { requests: TestApiRequest[] }, prefix: string): TestApiRequest[] =>
  host.requests.filter((request) => `${request.method} ${request.path}`.startsWith(prefix));

export type { Responses };
