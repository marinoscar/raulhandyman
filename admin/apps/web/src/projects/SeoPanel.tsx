import { useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import type { LintIssue, LintResult } from './types';
import { SITE_HOST, SITE_THEME } from './siteTheme';
import { focusById, measureTextWidth, truncateToWidth, type MeasureText } from './textUtils';

export const GOOGLE_TITLE_FONT = '20px Arial';
export const GOOGLE_TITLE_MAX_PX = 580;
export const GOOGLE_DESCRIPTION_FONT = '14px Arial';
export const GOOGLE_DESCRIPTION_MAX_PX = 920;

/** The DOM id of the control a lint issue points at (see the sections' `id`s). */
export function fieldIdForIssue(issue: Pick<LintIssue, 'field' | 'photoId'>): string {
  if (issue.photoId) {
    if (issue.field === 'altText') return `photo-alt-${issue.photoId}`;
    if (issue.field === 'caption') return `photo-caption-${issue.photoId}`;
    return `photo-card-${issue.photoId}`;
  }
  switch (issue.field) {
    case 'coverPhotoId':
    case 'photos':
      return 'photos-section-heading';
    default:
      return `field-${issue.field}`;
  }
}

export interface SeoPanelProps {
  title: string;
  seoTitle: string;
  metaDescription: string;
  summary?: string;
  slug: string;
  /** The live lint of the unsaved form (`lintProject` from `@app/shared`). */
  lint: LintResult;
  /** A signed URL of the branded OG image of the cover, if there is one. */
  ogImageUrl?: string | null;
  /** Moves to a field (the editor opens the section first); defaults to scrolling to and focusing it. */
  onGoToField?: (issue: LintIssue) => void;
  /** Injectable for tests; defaults to canvas `measureText`. */
  measure?: MeasureText;
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? 'success.main' : score >= 50 ? 'warning.main' : 'error.main';
  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }} role="img" aria-label={`SEO score ${score} out of 100`}>
      <CircularProgress variant="determinate" value={100} size={64} sx={{ color: 'action.hover' }} aria-hidden />
      <CircularProgress variant="determinate" value={score} size={64} sx={{ color, position: 'absolute', left: 0 }} aria-hidden />
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <Typography variant="subtitle1" component="span" sx={{ fontWeight: 700 }}>
          {score}
        </Typography>
      </Box>
    </Box>
  );
}

function IssueRow({ issue, severity, onGo }: { issue: LintIssue; severity: 'error' | 'warning'; onGo: (issue: LintIssue) => void }) {
  const Icon = severity === 'error' ? ErrorOutlineIcon : WarningAmberIcon;
  return (
    <Stack component="li" direction="row" spacing={1} sx={{ alignItems: 'flex-start', py: 0.5, color: severity === 'error' ? 'error.main' : 'warning.dark' }}>
      <Icon fontSize="small" aria-label={severity === 'error' ? 'Error' : 'Warning'} sx={{ mt: 0.25 }} />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, color: 'text.primary' }}>
        {issue.message}
      </Typography>
      <Button size="small" onClick={() => onGo(issue)} aria-label={`Go to field: ${issue.message}`} sx={{ flexShrink: 0 }}>
        Go to field
      </Button>
    </Stack>
  );
}

/** How the project will look in Google and when shared, and what the SEO lint says (errors block publishing). */
export function SeoPanel({ title, seoTitle, metaDescription, summary = '', slug, lint, ogImageUrl, onGoToField, measure = measureTextWidth }: SeoPanelProps) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const shownTitle = (seoTitle.trim() || title.trim() || 'Untitled project');
  const shownDescription = metaDescription.trim() || summary.trim();
  const titleView = useMemo(() => truncateToWidth(shownTitle, GOOGLE_TITLE_MAX_PX, GOOGLE_TITLE_FONT, measure), [shownTitle, measure]);
  const descriptionView = useMemo(
    () => truncateToWidth(shownDescription || 'No meta description yet. Google will pick text from the page.', GOOGLE_DESCRIPTION_MAX_PX, GOOGLE_DESCRIPTION_FONT, measure),
    [shownDescription, measure],
  );
  const go = onGoToField ?? ((issue: LintIssue) => void focusById(fieldIdForIssue(issue)));

  return (
    <Stack spacing={3}>
      <Box>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="subtitle1" component="h3">
            Google result preview
          </Typography>
          <ToggleButtonGroup size="small" exclusive value={device} onChange={(_, value: 'desktop' | 'mobile' | null) => value && setDevice(value)} aria-label="Preview device">
            <ToggleButton value="desktop">Desktop</ToggleButton>
            <ToggleButton value="mobile">Mobile</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Box
          data-testid="google-preview"
          data-device={device}
          sx={{ bgcolor: '#fff', color: '#202124', border: 1, borderColor: 'divider', borderRadius: 2, p: 2, maxWidth: device === 'mobile' ? 360 : 652, fontFamily: 'Arial, sans-serif', overflow: 'hidden' }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <Box aria-hidden sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: SITE_THEME.navy, color: SITE_THEME.goldBright, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              RH
            </Box>
            <Typography component="span" sx={{ fontSize: 12, color: '#4d5156', minWidth: 0, overflowWrap: 'anywhere' }}>
              {SITE_HOST} › projects › {slug || '…'}
            </Typography>
          </Stack>
          <Typography data-testid="google-title" component="div" sx={{ fontSize: 20, lineHeight: 1.3, color: '#1a0dab', fontFamily: 'Arial, sans-serif', overflowWrap: 'anywhere' }}>
            {titleView.text}
          </Typography>
          <Typography data-testid="google-description" component="div" sx={{ fontSize: 14, lineHeight: 1.58, color: '#4d5156', fontFamily: 'Arial, sans-serif', overflowWrap: 'anywhere' }}>
            {descriptionView.text}
          </Typography>
        </Box>
      </Box>

      <Box>
        <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>
          Social preview
        </Typography>
        <Box data-testid="social-preview" sx={{ maxWidth: 480, border: 1, borderColor: 'divider', borderRadius: `${SITE_THEME.radius}px`, overflow: 'hidden', bgcolor: SITE_THEME.surface }}>
          <Box sx={{ aspectRatio: '1200 / 630', bgcolor: SITE_THEME.navy, display: 'grid', placeItems: 'center' }}>
            {ogImageUrl ? (
              <Box component="img" src={ogImageUrl} alt="Social sharing image" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <Typography variant="body2" sx={{ color: SITE_THEME.onNavy, px: 2, textAlign: 'center' }}>
                The branded image appears once the cover photo is ready.
              </Typography>
            )}
          </Box>
          <Box sx={{ p: 1.5, color: SITE_THEME.ink }}>
            <Typography variant="caption" sx={{ color: SITE_THEME.muted, textTransform: 'uppercase' }}>
              {SITE_HOST}
            </Typography>
            <Typography variant="subtitle2" component="div" sx={{ overflowWrap: 'anywhere' }}>
              {shownTitle}
            </Typography>
            <Typography variant="body2" sx={{ color: SITE_THEME.muted, overflowWrap: 'anywhere' }}>
              {shownDescription}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
          <ScoreRing score={lint.score} />
          <Box>
            <Typography variant="subtitle1" component="h3">
              Checklist
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {lint.errors.length} {lint.errors.length === 1 ? 'error' : 'errors'} · {lint.warnings.length} {lint.warnings.length === 1 ? 'warning' : 'warnings'}
            </Typography>
          </Box>
        </Stack>
        {lint.errors.length === 0 && lint.warnings.length === 0 ? (
          <Typography color="success.main">All checks pass.</Typography>
        ) : (
          <Box component="ul" aria-label="SEO checklist" sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {lint.errors.map((issue, index) => (
              <IssueRow key={`e${index}`} issue={issue} severity="error" onGo={go} />
            ))}
            {lint.warnings.map((issue, index) => (
              <IssueRow key={`w${index}`} issue={issue} severity="warning" onGo={go} />
            ))}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
