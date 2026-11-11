import { useRef } from 'react';
import { Box, Typography } from '@mui/material';

import { PhotoCard } from './PhotoCard';
import { PhotoUploader, type PhotoUploaderProps } from './PhotoUploader';
import type { ProjectEditor } from './editor';
import type { Project } from './types';

export interface ProjectPhotosSectionProps {
  project: Project;
  editor: ProjectEditor;
  ai: { available: boolean; reason: string | null };
  canWrite: boolean;
  uploaderDeps?: PhotoUploaderProps['deps'];
}

/** The photos of a project: the uploader and a reorderable grid of cards. */
export function ProjectPhotosSection({ project, editor, ai, canWrite, uploaderDeps }: ProjectPhotosSectionProps) {
  const photos = project.photos;
  const dragging = useRef<string | null>(null);

  const move = (index: number, direction: -1 | 1) => {
    const ids = photos.map((photo) => photo.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void editor.reorderPhotos(ids);
  };

  const dropOn = (targetId: string) => {
    const from = dragging.current;
    dragging.current = null;
    if (!from || from === targetId) return;
    const ids = photos.map((photo) => photo.id).filter((id) => id !== from);
    ids.splice(ids.indexOf(targetId), 0, from);
    void editor.reorderPhotos(ids);
  };

  return (
    <Box>
      {canWrite && <PhotoUploader projectId={project.id} onUploaded={editor.addPhoto} {...(uploaderDeps ? { deps: uploaderDeps } : {})} />}
      {photos.length === 0 ? (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          No photos yet. Add at least two: the before and the after.
        </Typography>
      ) : (
        <Box component="ol" aria-label="Project photos" sx={{ listStyle: 'none', p: 0, m: 0, mt: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(auto-fill, minmax(320px, 1fr))' } }}>
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <PhotoCard
                photo={photo}
                index={index}
                count={photos.length}
                isCover={project.coverPhotoId === photo.id}
                retouching={editor.retouching.has(photo.id)}
                aiAvailable={ai.available}
                aiReason={ai.reason}
                aiBusy={editor.aiPending}
                onChange={(patch, options) => editor.updatePhoto(photo.id, patch, options)}
                onMove={(direction) => move(index, direction)}
                onSetCover={() => editor.setCover(photo.id)}
                onDelete={() => editor.removePhoto(photo.id)}
                onRetry={() => void editor.retryPhoto(photo.id)}
                onRetouch={() => void editor.retouch(photo.id)}
                onUseSuggestion={(fields) => void editor.apply({ photos: [{ photoId: photo.id, fields }] })}
                onAnother={(field) => void editor.regenerate({ photoId: photo.id, field })}
                dragHandlers={{
                  draggable: true,
                  onDragStart: () => {
                    dragging.current = photo.id;
                  },
                  onDragOver: (event) => event.preventDefault(),
                  onDrop: () => dropOn(photo.id),
                }}
              />
            </li>
          ))}
        </Box>
      )}
    </Box>
  );
}
