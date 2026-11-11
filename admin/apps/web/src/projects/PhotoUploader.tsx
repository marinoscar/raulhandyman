import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';

import { describeError } from './api';
import { useProjectsClient, useUploadDeps } from './hooks';
import { SITE_THEME } from './siteTheme';
import type { Photo } from './types';
import { HEIC_MESSAGE, MAX_CONCURRENT_UPLOADS, isHeic, uploadFile, type ResumeState, type UploadDeps } from './upload';

type ItemStatus = 'queued' | 'uploading' | 'attaching' | 'done' | 'error';

interface UploadItem {
  key: number;
  file: File;
  status: ItemStatus;
  progress: number;
  error: string | null;
  resume?: ResumeState;
}

export interface PhotoUploaderProps {
  projectId: string;
  onUploaded: (photo: Photo) => void;
  disabled?: boolean;
  /** Injectable for tests. */
  deps?: UploadDeps;
}

let nextKey = 1;

/**
 * Photo upload: choose or take photos (camera button), or drop them. At most three upload
 * at once, each with its own progress; a failed upload keeps what it sent and "Retry"
 * resumes it. A finished upload is attached with `POST /api/projects/:id/photos`.
 */
export function PhotoUploader({ projectId, onUploaded, disabled, deps }: PhotoUploaderProps) {
  const client = useProjectsClient();
  const defaultDeps = useUploadDeps();
  const uploadDeps = deps ?? defaultDeps;
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const chooseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const running = useRef(new Set<number>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = useCallback((key: number, change: Partial<UploadItem>) => {
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }, []);

  const start = useCallback(
    async (item: UploadItem) => {
      running.current.add(item.key);
      patch(item.key, { status: 'uploading', error: null });
      try {
        const objectId = await uploadFile(
          item.file,
          uploadDeps,
          {
            onProgress: (progress) => patch(item.key, { progress }),
            onState: (resume) => patch(item.key, { resume }),
          },
          itemsRef.current.find((entry) => entry.key === item.key)?.resume,
        );
        patch(item.key, { status: 'attaching', progress: 1 });
        const photo = await client.addPhoto(projectId, objectId);
        onUploaded(photo);
        patch(item.key, { status: 'done' });
      } catch (error) {
        patch(item.key, { status: 'error', error: describeError(error, 'Upload failed').message });
      } finally {
        running.current.delete(item.key);
      }
    },
    [client, onUploaded, patch, projectId, uploadDeps],
  );

  // Start queued uploads while fewer than three run.
  useEffect(() => {
    for (const item of items) {
      if (running.current.size >= MAX_CONCURRENT_UPLOADS) break;
      if (item.status === 'queued' && !running.current.has(item.key)) void start(item);
    }
  }, [items, start]);

  const add = (files: FileList | File[] | null) => {
    if (!files || disabled) return;
    const added: UploadItem[] = Array.from(files).map((file) =>
      isHeic(file)
        ? { key: nextKey++, file, status: 'error', progress: 0, error: HEIC_MESSAGE }
        : { key: nextKey++, file, status: 'queued', progress: 0, error: null },
    );
    setItems((list) => [...list, ...added]);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  };

  const visible = items.filter((item) => item.status !== 'done');

  return (
    <Box>
      <Box
        id="photo-uploader"
        tabIndex={-1}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        sx={{ border: 2, borderStyle: 'dashed', borderColor: dragging ? SITE_THEME.gold : 'divider', borderRadius: `${SITE_THEME.radius}px`, p: 2, textAlign: 'center', bgcolor: dragging ? 'action.hover' : 'transparent' }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'center' }}>
          <Button variant="contained" startIcon={<AddPhotoAlternateOutlinedIcon />} onClick={() => chooseRef.current?.click()} disabled={disabled} sx={{ minHeight: 48 }}>
            Add photos
          </Button>
          <Button variant="outlined" startIcon={<PhotoCameraOutlinedIcon />} onClick={() => cameraRef.current?.click()} disabled={disabled} sx={{ minHeight: 48 }}>
            Take photo
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, display: { xs: 'none', sm: 'block' } }}>
          or drop photos here
        </Typography>
        <input
          ref={chooseRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          multiple
          hidden
          aria-label="Choose photos"
          data-testid="photo-file-input"
          onChange={(event) => {
            add(event.target.files);
            event.target.value = '';
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label="Take a photo with the camera"
          data-testid="photo-camera-input"
          onChange={(event) => {
            add(event.target.files);
            event.target.value = '';
          }}
        />
      </Box>

      {visible.length > 0 && (
        <Stack component="ul" spacing={1} aria-label="Uploads" sx={{ listStyle: 'none', p: 0, mt: 1.5 }}>
          {visible.map((item) => (
            <Box component="li" key={item.key}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                  {item.file.name}
                </Typography>
                {item.status === 'error' && !isHeic(item.file) && (
                  <Button size="small" onClick={() => patch(item.key, { status: 'queued' })} aria-label={`Retry upload of ${item.file.name}`}>
                    Retry
                  </Button>
                )}
                {item.status === 'error' && isHeic(item.file) && (
                  <Button size="small" onClick={() => setItems((list) => list.filter((entry) => entry.key !== item.key))} aria-label={`Dismiss ${item.file.name}`}>
                    Dismiss
                  </Button>
                )}
              </Stack>
              {item.status === 'error' ? (
                <Alert severity="error" sx={{ mt: 0.5 }}>
                  {item.error}
                </Alert>
              ) : (
                <LinearProgress
                  variant={item.status === 'queued' || item.status === 'attaching' ? 'indeterminate' : 'determinate'}
                  value={Math.round(item.progress * 100)}
                  aria-label={`Uploading ${item.file.name}`}
                  sx={{ mt: 0.5 }}
                />
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
