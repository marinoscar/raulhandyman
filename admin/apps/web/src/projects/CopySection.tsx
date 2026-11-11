import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { LIMITS } from '@app/shared/seo-lint';

import type { Draft } from './editor';
import { SuggestionChip } from './SuggestionChip';
import { MarkdownPreview } from './textUtils';
import type { ApplyProjectField, Project, RegenerateBody } from './types';

export interface CopyAi {
  available: boolean;
  reason: string | null;
  busy: boolean;
  onUse: (field: ApplyProjectField, titleOption?: 0 | 1 | 2) => void;
  onAnother: (body: RegenerateBody) => void;
}

export interface CopySectionProps {
  draft: Draft;
  project: Pick<Project, 'status' | 'aiSuggestion'>;
  ai: CopyAi;
  disabled?: boolean;
  /** Which of the three suggested titles is selected (the page keeps it, so "Apply all" uses it too). */
  titleOption: 0 | 1 | 2;
  onTitleOptionChange: (option: 0 | 1 | 2) => void;
  onChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}

const counter = (length: number, max: number) => `${length}/${max}`;

/** Title, slug, SEO title, meta description, summary and body, each with its AI suggestion. */
export function CopySection({ draft, project, ai, disabled, titleOption, onTitleOptionChange, onChange }: CopySectionProps) {
  const output = project.aiSuggestion?.output;
  const published = project.status === 'published';
  const [slugUnlocked, setSlugUnlocked] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const slugLocked = published && !slugUnlocked;
  const anotherReason = ai.available ? null : ai.reason;

  const suggestion = (field: Exclude<ApplyProjectField, 'title'>, label: string, current: string) => {
    const proposed = output?.[field];
    if (typeof proposed !== 'string' || proposed.trim() === '' || proposed === current) return null;
    const regenerable = field !== 'slug';
    return (
      <SuggestionChip
        label={label}
        value={proposed}
        busy={ai.busy}
        onUse={() => ai.onUse(field)}
        {...(regenerable ? { onAnother: () => ai.onAnother({ field: field as 'seoTitle' | 'metaDescription' | 'summary' | 'body' }), anotherDisabledReason: anotherReason } : {})}
      />
    );
  };

  return (
    <Stack spacing={2}>
      <TextField
        id="field-title"
        label="Title"
        value={draft.title}
        onChange={(event) => onChange('title', event.target.value)}
        disabled={disabled}
        fullWidth
        helperText={counter(draft.title.length, LIMITS.title.max)}
        error={draft.title.length > LIMITS.title.max}
      />
      {output && output.titleOptions.length > 0 && (
        <FormControl sx={{ mt: -1 }}>
          <FormLabel id="title-options-label">Suggested titles</FormLabel>
          <RadioGroup aria-labelledby="title-options-label" value={String(titleOption)} onChange={(event) => onTitleOptionChange(Number(event.target.value) as 0 | 1 | 2)}>
            {output.titleOptions.map((option, index) => (
              <FormControlLabel key={index} value={String(index)} control={<Radio size="small" />} label={option} />
            ))}
          </RadioGroup>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" disabled={ai.busy} onClick={() => ai.onUse('title', titleOption)} aria-label="Use selected title">
              Use
            </Button>
            <span title={anotherReason ?? undefined}>
              <Button size="small" disabled={ai.busy || Boolean(anotherReason)} onClick={() => ai.onAnother({ field: 'title' })} aria-label="Another option for title">
                Another option
              </Button>
            </span>
          </Stack>
        </FormControl>
      )}

      <Box>
        <TextField
          id="field-slug"
          label="Slug"
          value={draft.slug}
          onChange={(event) => onChange('slug', event.target.value)}
          disabled={disabled || slugLocked}
          fullWidth
          helperText={published && slugUnlocked ? 'Changing the address creates a redirect from the old one.' : 'The web address of the project.'}
        />
        {slugLocked && (
          <Button size="small" onClick={() => setConfirmUnlock(true)} sx={{ mt: 0.5 }}>
            Unlock slug
          </Button>
        )}
        {suggestion('slug', 'slug', draft.slug)}
      </Box>

      <Box>
        <TextField
          id="field-seoTitle"
          label="SEO title"
          value={draft.seoTitle}
          onChange={(event) => onChange('seoTitle', event.target.value)}
          disabled={disabled}
          fullWidth
          helperText={counter(draft.seoTitle.length, LIMITS.seoTitle.max)}
          error={draft.seoTitle.length > LIMITS.seoTitle.max}
        />
        {suggestion('seoTitle', 'SEO title', draft.seoTitle)}
      </Box>

      <Box>
        <TextField
          id="field-metaDescription"
          label="Meta description"
          value={draft.metaDescription}
          onChange={(event) => onChange('metaDescription', event.target.value)}
          disabled={disabled}
          fullWidth
          multiline
          minRows={2}
          helperText={counter(draft.metaDescription.length, LIMITS.meta.max)}
          error={draft.metaDescription.length > LIMITS.meta.max}
        />
        {suggestion('metaDescription', 'meta description', draft.metaDescription)}
      </Box>

      <Box>
        <TextField
          id="field-summary"
          label="Summary"
          value={draft.summary}
          onChange={(event) => onChange('summary', event.target.value)}
          disabled={disabled}
          fullWidth
          multiline
          minRows={2}
          helperText={counter(draft.summary.length, 280)}
        />
        {suggestion('summary', 'summary', draft.summary)}
      </Box>

      <Box>
        <Tabs value={tab} onChange={(_, value: 'write' | 'preview') => setTab(value)} aria-label="Body editor mode">
          <Tab value="write" label="Write" id="body-tab-write" aria-controls="body-panel" />
          <Tab value="preview" label="Preview" id="body-tab-preview" aria-controls="body-panel" />
        </Tabs>
        <Box id="body-panel" role="tabpanel" aria-labelledby={`body-tab-${tab}`} sx={{ pt: 1.5 }}>
          {tab === 'write' ? (
            <TextField
              id="field-body"
              label="Body (markdown)"
              value={draft.body}
              onChange={(event) => onChange('body', event.target.value)}
              disabled={disabled}
              fullWidth
              multiline
              minRows={8}
              helperText={`${draft.body.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length} words · aim for ${LIMITS.bodyGoodWords}+`}
            />
          ) : (
            <MarkdownPreview source={draft.body} />
          )}
        </Box>
        {suggestion('body', 'body', draft.body)}
      </Box>

      <Dialog open={confirmUnlock} onClose={() => setConfirmUnlock(false)} aria-labelledby="unlock-slug-title">
        <DialogTitle id="unlock-slug-title">Change the address?</DialogTitle>
        <DialogContent>
          <DialogContentText>This project is published. Changing the address creates a redirect from the old one to the new one.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmUnlock(false)}>Keep the address</Button>
          <Button
            variant="contained"
            onClick={() => {
              setSlugUnlocked(true);
              setConfirmUnlock(false);
            }}
          >
            Unlock slug
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/** The AI's warnings about the draft ("the notes mention X but it isn't visible in the photos"). */
export function AiWarnings({ warnings }: { warnings: readonly string[] | undefined }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      <Typography variant="subtitle2" component="p">
        Check these before you use the suggestion
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2 }}>
        {warnings.map((warning, index) => (
          <li key={index}>{warning}</li>
        ))}
      </Box>
    </Alert>
  );
}
