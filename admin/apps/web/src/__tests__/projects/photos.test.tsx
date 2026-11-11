import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestApiError } from '@marinoscar/platform-web/testing';
import type { StorageObjectsClient } from '@marinoscar/platform-web/storage/headless';

import { ProjectEditorPage } from '../../pages/ProjectEditorPage';
import { HEIC_MESSAGE, RESUMABLE_THRESHOLD_BYTES, uploadFile, type UploadDeps } from '../../projects/upload';
import { catalog, calls, ID, photo, project, P1, P2, P3, renderWithHost, summary } from './fixtures';
import type { Project } from '../../projects/types';

const permissions = ['projects:read', 'projects:write', 'ai:use'];

function setup(current: Project, extra: Record<string, unknown> = {}, uploaderDeps?: UploadDeps) {
  return renderWithHost(<ProjectEditorPage {...(uploaderDeps ? { uploaderDeps } : {})} />, {
    route: `/projects/${ID}`,
    path: '/projects/:id',
    permissions,
    responses: {
      'GET /projects/catalog': catalog,
      [`GET /projects/${ID}`]: current,
      'GET /ai/config': { enabled: true },
      ...extra,
    },
  });
}

const bigFile = () => new File([new Uint8Array(RESUMABLE_THRESHOLD_BYTES * 2 + 1024)], 'big-job.jpg', { type: 'image/jpeg' });

/** A storage client double that records its calls; parts are 5 MB. */
function fakeStorage(overrides: Partial<StorageObjectsClient> = {}) {
  const storage = {
    upload: vi.fn(async () => ({ id: 'obj-simple', status: 'ready' })),
    initUpload: vi.fn(async () => ({
      objectId: 'obj-big',
      uploadId: 'u1',
      partSize: RESUMABLE_THRESHOLD_BYTES,
      totalParts: 3,
      presignedUrls: [1, 2, 3].map((partNumber) => ({ partNumber, url: `https://storage.example.test/part/${partNumber}` })),
      partUploadAuth: 'none' as const,
    })),
    partUrls: vi.fn(async (_id: string, input: { partNumbers: number[] }) => ({
      presignedUrls: input.partNumbers.map((partNumber) => ({ partNumber, url: `https://storage.example.test/part/${partNumber}` })),
      partUploadAuth: 'none' as const,
    })),
    uploadStatus: vi.fn(async () => ({ objectId: 'obj-big', status: 'uploading', uploadedParts: [1], totalParts: 3, uploadedBytes: '1', totalBytes: '2' })),
    completeUpload: vi.fn(async () => ({ id: 'obj-big', status: 'ready' })),
    waitForReady: vi.fn(async (object: unknown) => object),
    ...overrides,
  };
  return storage as unknown as StorageObjectsClient & typeof storage;
}

describe('uploadFile', () => {
  it('uses one simple request below 5 MB', async () => {
    const storage = fakeStorage();
    const file = new File(['x'.repeat(1000)], 'small.jpg', { type: 'image/jpeg' });
    await expect(uploadFile(file, { storage })).resolves.toBe('obj-simple');
    expect(storage.upload).toHaveBeenCalledWith(file, 'small.jpg');
    expect(storage.initUpload).not.toHaveBeenCalled();
  });

  it('goes init -> PUT parts -> complete for a big file', async () => {
    const storage = fakeStorage();
    const putPart = vi.fn(async (url: string) => `"etag-${url.split('/').pop()}"`);
    await expect(uploadFile(bigFile(), { storage, putPart })).resolves.toBe('obj-big');
    expect(storage.initUpload).toHaveBeenCalledWith({ name: 'big-job.jpg', size: RESUMABLE_THRESHOLD_BYTES * 2 + 1024, mimeType: 'image/jpeg' });
    expect(putPart).toHaveBeenCalledTimes(3);
    expect(storage.completeUpload).toHaveBeenCalledWith('obj-big', { parts: [1, 2, 3].map((n) => ({ partNumber: n, eTag: `"etag-${n}"` })) });
  });

  it('resumes after a failed part: asks the status and sends only the parts still missing', async () => {
    const storage = fakeStorage();
    let state: Parameters<NonNullable<Parameters<typeof uploadFile>[2]>['onState'] & ((s: never) => void)>[0] | undefined;
    const failing = vi.fn(async (url: string) => {
      if (url.endsWith('/2')) throw new Error('network lost');
      return `"etag-${url.split('/').pop()}"`;
    });
    await expect(uploadFile(bigFile(), { storage, putPart: failing }, { onState: (s) => (state = s as never) })).rejects.toThrow('network lost');
    expect(failing).toHaveBeenCalledTimes(2); // part 1 stored, part 2 failed

    const resumed = vi.fn(async (url: string) => `"etag-${url.split('/').pop()}"`);
    await expect(uploadFile(bigFile(), { storage, putPart: resumed }, {}, state as never)).resolves.toBe('obj-big');
    expect(storage.uploadStatus).toHaveBeenCalledWith('obj-big');
    expect(storage.initUpload).toHaveBeenCalledTimes(1); // not started over
    expect(resumed.mock.calls.map(([url]) => url)).toEqual(['https://storage.example.test/part/2', 'https://storage.example.test/part/3']);
    expect(storage.completeUpload).toHaveBeenCalledWith('obj-big', { parts: [1, 2, 3].map((n) => ({ partNumber: n, eTag: `"etag-${n}"` })) });
  });
});

describe('PhotoUploader', () => {
  it('uploads a small photo and shows its card (happy path through the host API)', async () => {
    const user = userEvent.setup();
    const { host } = setup(project(), {
      'POST /storage/objects': { id: 'obj-1', name: 'a.jpg', status: 'ready' },
      [`POST /projects/${ID}/photos`]: photo(P1, { processingStatus: 'processing', previews: {} }),
    });
    const input = await screen.findByTestId('photo-file-input');
    expect(input).toHaveAttribute('multiple');
    expect(input).toHaveAttribute('accept', expect.stringContaining('image/jpeg'));
    await user.upload(input, new File(['small'], 'a.jpg', { type: 'image/jpeg' }));

    expect(await screen.findByRole('article', { name: 'Photo 1 of 1' })).toBeInTheDocument();
    expect(calls(host, `POST /projects/${ID}/photos`)[0]?.body).toEqual({ storageObjectId: 'obj-1' });
    expect(screen.getByRole('progressbar', { name: 'Processing' })).toBeInTheDocument();
  });

  it('has a separate "Take photo" input that opens the rear camera', async () => {
    setup(project());
    await screen.findByTestId('photo-file-input');
    expect(screen.getByTestId('photo-camera-input')).toHaveAttribute('capture', 'environment');
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeInTheDocument();
  });

  it('retries a failed big upload from where it stopped', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage();
    let failPart2 = true;
    const putPart = vi.fn(async (url: string) => {
      if (url.endsWith('/2') && failPart2) throw new Error('network lost');
      return `"etag-${url.split('/').pop()}"`;
    });
    setup(project(), { [`POST /projects/${ID}/photos`]: photo(P1) }, { storage, putPart });
    await user.upload(await screen.findByTestId('photo-file-input'), bigFile());

    const retry = await screen.findByRole('button', { name: 'Retry upload of big-job.jpg' });
    expect(screen.getByText('network lost')).toBeInTheDocument();
    failPart2 = false;
    await user.click(retry);

    expect(await screen.findByRole('article', { name: 'Photo 1 of 1' })).toBeInTheDocument();
    expect(storage.uploadStatus).toHaveBeenCalledTimes(1);
    expect(putPart).toHaveBeenCalledTimes(4); // 1, 2 (failed), then 2 and 3
  });

  it('runs at most three uploads at once', async () => {
    const user = userEvent.setup();
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const storage = fakeStorage({
      upload: vi.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active--;
        return { id: 'obj', status: 'ready' };
      }) as never,
    });
    setup(project(), { [`POST /projects/${ID}/photos`]: photo(P1) }, { storage });
    await user.upload(
      await screen.findByTestId('photo-file-input'),
      [1, 2, 3, 4, 5].map((n) => new File(['x'], `p${n}.jpg`, { type: 'image/jpeg' })),
    );
    await waitFor(() => expect(release).toHaveLength(3));
    expect(peak).toBe(3);
    expect(storage.upload).toHaveBeenCalledTimes(3);
    release.splice(0).forEach((fn) => fn());
    await waitFor(() => expect(storage.upload).toHaveBeenCalledTimes(5));
  });

  it('refuses a HEIC photo with the helpful message, before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const storage = fakeStorage();
    setup(project(), {}, { storage });
    await user.upload(await screen.findByTestId('photo-file-input'), new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' }));
    expect(await screen.findByText(HEIC_MESSAGE)).toBeInTheDocument();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("shows the API's rejection when it refuses the photo", async () => {
    const user = userEvent.setup();
    setup(project(), {
      'POST /storage/objects': { id: 'obj-1', status: 'ready' },
      [`POST /projects/${ID}/photos`]: () => {
        throw createTestApiError(400, HEIC_MESSAGE);
      },
    });
    await user.upload(await screen.findByTestId('photo-file-input'), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText(HEIC_MESSAGE)).toBeInTheDocument();
  });
});

describe('photo cards', () => {
  const two = () => project({ photos: [photo(P1), photo(P2, { role: 'before' })], coverPhotoId: P1 });

  it('shows the signed thumb, lazily loaded, in each card', async () => {
    setup(two());
    const card = await screen.findByRole('article', { name: 'Photo 1 of 2' });
    const image = card.querySelector('img');
    expect(image).toHaveAttribute('src', `https://img.example.test/${P1}/thumb.webp`);
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('reorders with the up/down buttons and sends the FULL id list', async () => {
    const user = userEvent.setup();
    const { host } = setup(project({ photos: [photo(P1), photo(P2), photo(P3)] }), { [`POST /projects/${ID}/photos/reorder`]: {} });
    await user.click(await screen.findByRole('button', { name: 'Move photo 1 down' }));
    await waitFor(() => expect(calls(host, `POST /projects/${ID}/photos/reorder`)).toHaveLength(1));
    expect(calls(host, `POST /projects/${ID}/photos/reorder`)[0]?.body).toEqual({ photoIds: [P2, P1, P3] });
    expect(screen.getByRole('button', { name: 'Move photo 1 up' })).toBeDisabled();
    const articles = screen.getAllByRole('article');
    expect(within(articles[0]!).getByRole('button', { name: 'Move photo 1 down' })).toBeInTheDocument();
  });

  it('hides "Retouch with AI" for a before photo and explains why; shows it for others', async () => {
    const user = userEvent.setup();
    const { host } = setup(two(), { [`POST /projects/${ID}/photos/${P1}/retouch`]: { jobId: 'job' } });
    const [after, before] = await screen.findAllByRole('article');
    await user.click(within(before!).getByRole('button', { name: 'Preview and framing' }));
    expect(within(before!).queryByRole('button', { name: /Retouch with AI/ })).not.toBeInTheDocument();
    expect(within(before!).getByText('Before photos are kept untouched so they stay honest.')).toBeInTheDocument();

    await user.click(within(after!).getByRole('button', { name: 'Preview and framing' }));
    const retouch = await within(after!).findByRole('button', { name: /Retouch with AI/ });
    await waitFor(() => expect(retouch).toBeEnabled());
    await user.click(retouch);
    await waitFor(() => expect(calls(host, `POST /projects/${ID}/photos/${P1}/retouch`)).toHaveLength(1));
    expect(calls(host, `POST /projects/${ID}/photos/${P1}/retouch`)[0]?.body).toEqual({ options: { declutter: true, evenLighting: true, straighten: true } });
  });

  it('offers the Retouched version only when it exists', async () => {
    const user = userEvent.setup();
    setup(project({ photos: [photo(P1), photo(P2, { retouchedObjectId: 'ret', previews: { ...photo(P2).previews, retouched: 'https://img.example.test/r.jpg' } })] }));
    const [first, second] = await screen.findAllByRole('article');
    await user.click(within(first!).getByRole('button', { name: 'Preview and framing' }));
    expect(within(first!).queryByRole('button', { name: 'Retouched' })).not.toBeInTheDocument();
    await user.click(within(second!).getByRole('button', { name: 'Preview and framing' }));
    expect(within(second!).getByRole('button', { name: 'Retouched' })).toBeInTheDocument();
    expect(within(second!).getByRole('button', { name: 'Original' })).toBeInTheDocument();
  });

  it('sends normalised focal coordinates when the preview is tapped', async () => {
    const user = userEvent.setup();
    const { host } = setup(project({ photos: [photo(P1)] }), { [`PATCH /projects/${ID}/photos/${P1}`]: photo(P1, { processingStatus: 'processing' }) });
    await user.click(await screen.findByRole('button', { name: 'Preview and framing' }));
    const picker = await screen.findByTestId(`focal-picker-${P1}`);
    picker.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 100, right: 300, bottom: 150, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect;

    fireEvent.pointerDown(picker, { clientX: 250, clientY: 75, pointerId: 1 });
    fireEvent.pointerUp(picker, { clientX: 250, clientY: 75, pointerId: 1 });

    await waitFor(() => expect(calls(host, `PATCH /projects/${ID}/photos/${P1}`)).toHaveLength(1));
    expect(calls(host, `PATCH /projects/${ID}/photos/${P1}`)[0]?.body).toEqual({ focalX: 0.75, focalY: 0.25 });
  });

  it('moves the focal point with the arrow keys', async () => {
    const user = userEvent.setup();
    const { host } = setup(project({ photos: [photo(P1)] }), { [`PATCH /projects/${ID}/photos/${P1}`]: photo(P1) });
    await user.click(await screen.findByRole('button', { name: 'Preview and framing' }));
    const picker = await screen.findByTestId(`focal-picker-${P1}`);
    picker.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(calls(host, `PATCH /projects/${ID}/photos/${P1}`)).toHaveLength(1));
    expect(calls(host, `PATCH /projects/${ID}/photos/${P1}`)[0]?.body).toEqual({ focalX: 0.52, focalY: 0.5 });
  });

  it('shows failures with a Retry, and quality and privacy warnings', async () => {
    const user = userEvent.setup();
    const { host } = setup(
      project({ photos: [photo(P1, { processingStatus: 'failed', processingError: 'Could not read the image', qualityFlags: ['too_dark'], privacyFlags: ['house_number'] })] }),
      { [`POST /projects/${ID}/photos/${P1}/reprocess`]: { jobId: 'j' } },
    );
    expect(await screen.findByText('Could not read the image')).toBeInTheDocument();
    expect(screen.getByText('Photo looks dark')).toBeInTheDocument();
    expect(screen.getByText('A house number may be visible — crop or retouch')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls(host, `POST /projects/${ID}/photos/${P1}/reprocess`)).toHaveLength(1));
  });

  it('counts alt text and caption, marks alt text required, and applies a suggestion', async () => {
    const user = userEvent.setup();
    const p = photo(P1, { altText: 'Short', aiSuggestion: { output: { altText: 'A patched hallway wall, sanded smooth' } } });
    const { host } = setup(project({ photos: [p], aiSuggestion: null }), { [`POST /projects/${ID}/ai/apply`]: summary({ version: 4 }) });
    expect(await screen.findByText('5/125')).toBeInTheDocument();
    expect(screen.getByText('0/160')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use suggested alt text' }));
    await waitFor(() => expect(calls(host, `POST /projects/${ID}/ai/apply`)).toHaveLength(1));
    expect(calls(host, `POST /projects/${ID}/ai/apply`)[0]?.body).toEqual({ photos: [{ photoId: P1, fields: ['altText'] }] });
  });
});
