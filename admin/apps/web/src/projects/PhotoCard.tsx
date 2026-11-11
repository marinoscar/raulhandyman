import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Slider,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { LIMITS } from '@app/shared/seo-lint';

import { ROLE_LABELS } from './editor';
import { SITE_THEME } from './siteTheme';
import { SuggestionChip } from './SuggestionChip';
import type { Photo, PhotoCopyOutput, PhotoRole, PhotoVariant, UpdatePhotoPatch } from './types';

export const ALT_MAX = 125;
export const CAPTION_MAX = 160;
export const BEFORE_HONESTY_TEXT = 'Before photos are kept untouched so they stay honest.';

const QUALITY_TEXT: Record<string, string> = {
  too_small: 'Photo is small — a larger photo will look sharper',
  too_dark: 'Photo looks dark',
  blurry: 'Photo looks blurry',
  low_contrast: 'Photo looks flat (low contrast)',
};
const PRIVACY_TEXT: Record<string, string> = {
  house_number: 'A house number may be visible — crop or retouch',
  license_plate: 'A license plate may be visible — crop or retouch',
  person: 'A person may be visible — crop or retouch',
  other_pii: 'Personal details may be visible — crop or retouch',
};

/** The photo's AI suggestion, whether stored as the `{ output }` envelope or bare. */
export function photoSuggestionOf(photo: Pick<Photo, 'aiSuggestion'>): PhotoCopyOutput | null {
  const raw = photo.aiSuggestion;
  if (!raw || typeof raw !== 'object') return null;
  const envelope = raw as { output?: PhotoCopyOutput };
  return envelope.output ?? (raw as PhotoCopyOutput);
}

type CropTab = 'card' | 'hero' | 'social';
const CROPS: Record<CropTab, { label: string; ratio: number; frame: string }> = {
  card: { label: 'Card 4:3', ratio: 4 / 3, frame: 'card4x3' },
  hero: { label: 'Hero 16:9', ratio: 16 / 9, frame: 'hero16x9' },
  social: { label: 'Social', ratio: 1200 / 630, frame: 'ogBranded' },
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface PhotoCardProps {
  photo: Photo;
  index: number;
  count: number;
  isCover: boolean;
  retouching: boolean;
  aiAvailable: boolean;
  aiReason: string | null;
  aiBusy: boolean;
  onChange: (patch: UpdatePhotoPatch, options?: { immediate?: boolean }) => void;
  onMove: (direction: -1 | 1) => void;
  onSetCover: () => void;
  onDelete: () => Promise<void> | void;
  onRetry: () => void;
  onRetouch: () => void;
  onUseSuggestion: (fields: Array<'altText' | 'caption' | 'fileSlug' | 'role'>) => void;
  onAnother: (field: 'altText' | 'caption') => void;
  dragHandlers?: {
    draggable: boolean;
    onDragStart: () => void;
    onDragOver: (event: React.DragEvent) => void;
    onDrop: () => void;
  };
}

/** Over the full photo: tap or drag (or use the arrow keys) to set where crops centre, with the active crop frame drawn. */
function FocalPicker({ photo, imageUrl, cropRatio, onCommit }: { photo: Photo; imageUrl: string | null; cropRatio: number; onCommit: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [focal, setFocal] = useState<{ x: number; y: number } | null>(null);
  const pressed = useRef(false);
  const shown = focal ?? { x: photo.focalX, y: photo.focalY };
  const imageRatio = photo.width && photo.height ? photo.width / photo.height : 4 / 3;

  const locate = (event: { clientX: number; clientY: number }) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
  };
  const down = (event: ReactPointerEvent) => {
    const next = locate(event);
    if (!next) return;
    pressed.current = true;
    try {
      ref.current?.setPointerCapture?.(event.pointerId);
    } catch {
      /* not capturable (tests) */
    }
    setFocal(next);
  };
  const move = (event: ReactPointerEvent) => {
    if (!pressed.current) return;
    const next = locate(event);
    if (next) setFocal(next);
  };
  const up = (event: ReactPointerEvent) => {
    if (!pressed.current) return;
    pressed.current = false;
    const next = locate(event) ?? focal;
    if (next) {
      setFocal(next);
      onCommit(next.x, next.y);
    }
  };
  const key = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = { x: clamp01(shown.x + delta[0]!), y: clamp01(shown.y + delta[1]!) };
    setFocal(next);
    onCommit(next.x, next.y);
  };

  // The crop frame (as a fraction of the image) for the active crop, centred on the focal point and kept inside.
  const frameW = cropRatio <= imageRatio ? cropRatio / imageRatio : 1;
  const frameH = cropRatio <= imageRatio ? 1 : imageRatio / cropRatio;
  const left = Math.min(1 - frameW, Math.max(0, shown.x - frameW / 2));
  const top = Math.min(1 - frameH, Math.max(0, shown.y - frameH / 2));

  return (
    <Box
      ref={ref}
      role="group"
      tabIndex={0}
      aria-label="Focal point. Tap or drag on the photo, or use the arrow keys, to choose what stays in the crop."
      data-testid={`focal-picker-${photo.id}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onKeyDown={key}
      sx={{ position: 'relative', touchAction: 'none', cursor: 'crosshair', aspectRatio: String(imageRatio), bgcolor: SITE_THEME.navy, borderRadius: `${SITE_THEME.radius}px`, overflow: 'hidden', outlineOffset: 2 }}
    >
      {imageUrl && <Box component="img" src={imageUrl} alt="" draggable={false} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', userSelect: 'none' }} />}
      <Box aria-hidden sx={{ position: 'absolute', left: `${left * 100}%`, top: `${top * 100}%`, width: `${frameW * 100}%`, height: `${frameH * 100}%`, border: `2px solid ${SITE_THEME.goldBright}`, boxShadow: '0 0 0 9999px rgba(14,31,61,0.45)', pointerEvents: 'none' }} />
      <Box aria-hidden sx={{ position: 'absolute', left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: 20, height: 20, ml: '-10px', mt: '-10px', borderRadius: '50%', border: `2px solid ${SITE_THEME.goldBright}`, bgcolor: 'rgba(255,255,255,0.6)', pointerEvents: 'none' }} />
    </Box>
  );
}

/** Original against the chosen variant: a slider reveals one over the other. */
function CompareSlider({ before, after, afterLabel }: { before: string; after: string; afterLabel: string }) {
  const [position, setPosition] = useState(50);
  return (
    <Box>
      <Box sx={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: `${SITE_THEME.radius}px`, overflow: 'hidden', bgcolor: SITE_THEME.navy }}>
        <Box component="img" src={after} alt={`${afterLabel} version`} loading="lazy" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <Box
          component="img"
          src={before}
          alt="Original version"
          loading="lazy"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />
        <Box aria-hidden sx={{ position: 'absolute', top: 0, bottom: 0, left: `${position}%`, width: 2, bgcolor: SITE_THEME.goldBright }} />
      </Box>
      <Slider size="small" value={position} onChange={(_, value) => setPosition(value as number)} aria-label={`Compare original and ${afterLabel.toLowerCase()}`} sx={{ mt: 0.5 }} />
    </Box>
  );
}

/** One photo: status, role, cover, variant compare, crop previews, focal point, alt text, caption, warnings. */
export function PhotoCard(props: PhotoCardProps) {
  const { photo, index, count, isCover, retouching, aiAvailable, aiReason, aiBusy, onChange, onMove, onSetCover, onDelete, onRetry, onRetouch, onUseSuggestion, onAnother, dragHandlers } = props;
  const previews = photo.previews ?? {};
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState<PhotoVariant>(photo.chosenVariant);
  const [crop, setCrop] = useState<CropTab>('card');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const processing = photo.processingStatus === 'pending' || photo.processingStatus === 'processing';
  const failed = photo.processingStatus === 'failed';
  const hasRetouched = Boolean(photo.retouchedObjectId || previews.retouched);
  const isBefore = photo.role === 'before';
  const suggestion = photoSuggestionOf(photo);
  const altLength = photo.altText.trim().length;
  const altRequired = altLength < LIMITS.altMin;
  const variantUrl = (name: PhotoVariant) => previews[name] ?? null;
  const original = variantUrl('original');
  const shownVariantUrl = variantUrl(variant);
  const cropUrl = crop === 'social' ? (previews.ogBranded ?? previews.og ?? null) : (previews[CROPS[crop].frame] ?? null);
  const focalBase = variantUrl('enhanced') ?? original ?? previews.card4x3 ?? null;
  const anotherReason = aiAvailable ? null : aiReason;

  return (
    <Paper
      variant="outlined"
      id={`photo-card-${photo.id}`}
      tabIndex={-1}
      component="article"
      aria-label={`Photo ${index + 1} of ${count}`}
      {...(dragHandlers ? { draggable: false, onDragOver: dragHandlers.onDragOver, onDrop: dragHandlers.onDrop } : {})}
      sx={{ p: 1.5, borderRadius: `${SITE_THEME.radius}px`, borderColor: isCover ? SITE_THEME.gold : 'divider', borderWidth: isCover ? 2 : 1 }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ position: 'relative', width: { xs: 112, sm: 160 }, flexShrink: 0, aspectRatio: '4 / 3', borderRadius: `${SITE_THEME.radius}px`, overflow: 'hidden', bgcolor: SITE_THEME.navy }}>
          {previews.thumb ? (
            <Box component="img" src={previews.thumb} alt={photo.altText || `Photo ${index + 1}`} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : null}
          {(processing || retouching) && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', bgcolor: 'rgba(14,31,61,0.55)' }}>
              <CircularProgress size={28} aria-label={retouching ? 'Retouching' : 'Processing'} sx={{ color: SITE_THEME.goldBright }} />
            </Box>
          )}
        </Box>
        <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            {processing ? (
              <Chip size="small" label="Processing" />
            ) : failed ? (
              <Chip size="small" color="error" label="Failed" />
            ) : (
              <Chip size="small" color="success" variant="outlined" label="Ready" />
            )}
            {isCover && <Chip size="small" color="warning" label="Cover" />}
          </Stack>
          <TextField select size="small" label="Role" value={photo.role} onChange={(event) => onChange({ role: event.target.value as PhotoRole }, { immediate: true })} id={`photo-role-${photo.id}`}>
            {(Object.keys(ROLE_LABELS) as PhotoRole[]).map((role) => (
              <MenuItem key={role} value={role}>
                {ROLE_LABELS[role]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={0.5} sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Tooltip title={isCover ? 'This is the cover photo' : 'Set as cover'}>
          <span>
            <IconButton aria-label={isCover ? 'Cover photo' : 'Set as cover'} aria-pressed={isCover} onClick={onSetCover} disabled={isCover || photo.processingStatus !== 'ready'} color={isCover ? 'warning' : 'default'}>
              {isCover ? <StarIcon /> : <StarBorderIcon />}
            </IconButton>
          </span>
        </Tooltip>
        <IconButton aria-label={`Move photo ${index + 1} up`} onClick={() => onMove(-1)} disabled={index === 0}>
          <ArrowUpwardIcon />
        </IconButton>
        <IconButton aria-label={`Move photo ${index + 1} down`} onClick={() => onMove(1)} disabled={index === count - 1}>
          <ArrowDownwardIcon />
        </IconButton>
        {dragHandlers && (
          <Box
            role="presentation"
            draggable
            onDragStart={dragHandlers.onDragStart}
            aria-hidden
            sx={{ display: { xs: 'none', sm: 'inline-flex' }, cursor: 'grab', p: 1, color: 'text.secondary' }}
            title="Drag to reorder"
          >
            <DragIndicatorIcon />
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        <IconButton aria-label={`Delete photo ${index + 1}`} onClick={() => setConfirmDelete(true)} color="error">
          <DeleteOutlineIcon />
        </IconButton>
      </Stack>

      {failed && (
        <Alert severity="error" sx={{ mt: 1 }} action={<Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}>
          {photo.processingError || 'This photo could not be processed.'}
        </Alert>
      )}
      {photo.privacyFlags.map((flag) => (
        <Alert key={flag} severity="warning" sx={{ mt: 1 }}>
          {PRIVACY_TEXT[flag] ?? 'Review this photo for private details'}
        </Alert>
      ))}
      {photo.qualityFlags.map((flag) => (
        <Alert key={flag} severity="info" sx={{ mt: 1 }}>
          {QUALITY_TEXT[flag] ?? 'Check the photo quality'}
        </Alert>
      ))}

      <TextField
        id={`photo-alt-${photo.id}`}
        label="Alt text"
        value={photo.altText}
        onChange={(event) => onChange({ altText: event.target.value })}
        fullWidth
        multiline
        size="small"
        sx={{ mt: 1.5 }}
        error={photo.altText.length > ALT_MAX}
        helperText={
          <Box component="span" sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <span>{altRequired ? 'Required: describe what the photo shows' : ' '}</span>
            <span>{`${photo.altText.length}/${ALT_MAX}`}</span>
          </Box>
        }
        slotProps={{ input: { endAdornment: altRequired ? <Chip size="small" color="error" variant="outlined" label="Required" sx={{ ml: 1 }} /> : undefined } }}
      />
      {suggestion?.altText && suggestion.altText !== photo.altText && (
        <SuggestionChip label="alt text" value={suggestion.altText} busy={aiBusy} onUse={() => onUseSuggestion(['altText'])} onAnother={() => onAnother('altText')} anotherDisabledReason={anotherReason} />
      )}
      <TextField
        id={`photo-caption-${photo.id}`}
        label="Caption"
        value={photo.caption}
        onChange={(event) => onChange({ caption: event.target.value })}
        fullWidth
        multiline
        size="small"
        sx={{ mt: 1.5 }}
        error={photo.caption.length > CAPTION_MAX}
        helperText={`${photo.caption.length}/${CAPTION_MAX}`}
      />
      {suggestion?.caption && suggestion.caption !== photo.caption && (
        <SuggestionChip label="caption" value={suggestion.caption} busy={aiBusy} onUse={() => onUseSuggestion(['caption'])} onAnother={() => onAnother('caption')} anotherDisabledReason={anotherReason} />
      )}
      {suggestion?.suggestedRole && suggestion.suggestedRole !== photo.role && (
        <SuggestionChip label="role" value={ROLE_LABELS[suggestion.suggestedRole]} busy={aiBusy} onUse={() => onUseSuggestion(['role'])} />
      )}

      <Button size="small" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={`photo-preview-${photo.id}`} sx={{ mt: 1 }}>
        {open ? 'Hide preview and framing' : 'Preview and framing'}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Box id={`photo-preview-${photo.id}`} sx={{ mt: 1 }}>
          <Typography variant="subtitle2" component="h4" sx={{ mb: 0.5 }}>
            Compare versions
          </Typography>
          <ToggleButtonGroup size="small" exclusive value={variant} onChange={(_, value: PhotoVariant | null) => value && setVariant(value)} aria-label="Photo version" sx={{ mb: 1 }}>
            <ToggleButton value="original">Original</ToggleButton>
            <ToggleButton value="enhanced">Enhanced</ToggleButton>
            {hasRetouched && <ToggleButton value="retouched">Retouched</ToggleButton>}
          </ToggleButtonGroup>
          {variant === 'original' ? (
            original && <Box component="img" src={original} alt="Original version" loading="lazy" sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: `${SITE_THEME.radius}px`, display: 'block' }} />
          ) : (
            original && shownVariantUrl && <CompareSlider before={original} after={shownVariantUrl} afterLabel={variant === 'enhanced' ? 'Enhanced' : 'Retouched'} />
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Chip size="small" label={`On the site: ${photo.chosenVariant}`} />
            {variant !== photo.chosenVariant && (
              <Button size="small" variant="outlined" onClick={() => onChange({ chosenVariant: variant }, { immediate: true })}>
                Use {variant} on the site
              </Button>
            )}
          </Stack>
          {isBefore ? (
            <Alert severity="info" sx={{ mt: 1 }}>
              {BEFORE_HONESTY_TEXT}
            </Alert>
          ) : (
            <span title={anotherReason ?? undefined}>
              <Button size="small" sx={{ mt: 1 }} onClick={onRetouch} disabled={!aiAvailable || retouching || photo.processingStatus !== 'ready'}>
                ✨ Retouch with AI
              </Button>
            </span>
          )}

          <Typography variant="subtitle2" component="h4" sx={{ mt: 2, mb: 0.5 }}>
            How it crops on the site
          </Typography>
          <Tabs value={crop} onChange={(_, value: CropTab) => setCrop(value)} aria-label="Crop preview" variant="scrollable" scrollButtons={false}>
            {(Object.keys(CROPS) as CropTab[]).map((key) => (
              <Tab key={key} value={key} label={CROPS[key].label} />
            ))}
          </Tabs>
          <Box
            data-testid={`crop-preview-${crop}`}
            sx={{ mt: 1, aspectRatio: String(CROPS[crop].ratio), borderRadius: `${SITE_THEME.radius}px`, border: `2px solid ${SITE_THEME.navy}`, bgcolor: SITE_THEME.navy, overflow: 'hidden', display: 'grid', placeItems: 'center' }}
          >
            {cropUrl ? (
              <Box component="img" src={cropUrl} alt={`${CROPS[crop].label} crop`} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <Typography variant="body2" sx={{ color: SITE_THEME.onNavy, p: 1, textAlign: 'center' }}>
                {processing ? 'Updating the crops…' : 'No crop yet'}
              </Typography>
            )}
          </Box>

          <Typography variant="subtitle2" component="h4" sx={{ mt: 2, mb: 0.5 }}>
            Focal point
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Tap the part of the photo that must stay in view. The gold frame shows the {CROPS[crop].label} crop.
          </Typography>
          <FocalPicker photo={photo} imageUrl={focalBase} cropRatio={CROPS[crop].ratio} onCommit={(x, y) => onChange({ focalX: x, focalY: y }, { immediate: true })} />
        </Box>
      </Collapse>

      <Dialog open={confirmDelete} onClose={() => !deleting && setConfirmDelete(false)} aria-labelledby={`delete-photo-${photo.id}`}>
        <DialogTitle id={`delete-photo-${photo.id}`}>Delete this photo?</DialogTitle>
        <DialogContent>
          <DialogContentText>The photo and all its versions are removed. This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>
            Keep it
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await onDelete();
              } finally {
                setDeleting(false);
                setConfirmDelete(false);
              }
            }}
          >
            Delete photo
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
