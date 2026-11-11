import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Link, Paper, Stack, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import { describeError } from './api';
import { useProjectsClient, useSiteStatus } from './hooks';
import { projectSiteUrl } from './siteTheme';
import type { LintIssue, LintResult, Project, PublishResult } from './types';

export interface PublishBarProps {
  project: Pick<Project, 'id' | 'slug' | 'status' | 'version'>;
  /** The live lint of the unsaved form: errors disable Publish. */
  lint: LintResult;
  /** Saves pending edits first; resolves to the project version to publish against. */
  prepare: () => Promise<number>;
  /** The page's own conflict handling (a 412 reloads and shows the notice). */
  onConflict: (error: unknown) => Promise<boolean>;
  /** Called with the project after a publish or unpublish. */
  onChanged: (result: PublishResult) => void;
  /** Unsaved or failed edits block publishing. */
  saveState: 'saved' | 'saving' | 'unsaved' | 'error';
}

/** Server-side lint errors of a 422, as `details.errors`. */
function serverErrors(details: unknown): LintIssue[] {
  const list = (details as { errors?: unknown } | undefined)?.errors;
  return Array.isArray(list) ? (list as LintIssue[]) : [];
}

/**
 * The publish controls, sticky at the bottom on a phone: Publish (draft; disabled while the
 * lint has errors, with the reason) or Unpublish and View on site (published), and the live
 * status of the site build. Only shown with `projects:publish` (the caller decides).
 */
export function PublishBar({ project, lint, prepare, onConflict, onChanged, saveState }: PublishBarProps) {
  const client = useProjectsClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; errors: LintIssue[] } | null>(null);
  const [acted, setActed] = useState(false);
  const published = project.status === 'published';
  const archived = project.status === 'archived';
  const site = useSiteStatus(published || acted);

  const errorCount = lint.errors.length;
  const unsaved = saveState === 'unsaved' || saveState === 'saving' || saveState === 'error';
  const blockedReason = archived
    ? 'Restore the archived project to draft before publishing.'
    : errorCount > 0
      ? `Fix ${errorCount} ${errorCount === 1 ? 'error' : 'errors'} before publishing.`
      : unsaved
        ? 'Saving your changes…'
        : null;

  const run = async (action: 'publish' | 'unpublish') => {
    setBusy(true);
    setProblem(null);
    try {
      const version = await prepare();
      const result = action === 'publish' ? await client.publish(project.id, version) : await client.unpublish(project.id, version);
      setActed(true);
      onChanged(result);
      void site.refresh();
    } catch (error) {
      if (await onConflict(error)) return;
      const { status, message, details } = describeError(error, `Could not ${action}`);
      setProblem({ message: status === 422 ? 'The server found problems that block publishing:' : message, errors: status === 422 ? serverErrors(details) : [] });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const liveText = site.live ? 'Live ✓' : site.failed ? 'Site update failed — admins notified' : 'Waiting for site update (usually 2–4 min)';
  const showLive = (published || acted) && site.status !== null;

  return (
    <Paper
      component="section"
      aria-label="Publishing"
      elevation={6}
      sx={{
        position: 'sticky',
        bottom: { xs: 64, sm: 0 },
        zIndex: (theme) => theme.zIndex.appBar - 1,
        mt: 2,
        p: 1.5,
        borderRadius: { xs: 2, sm: 1 },
      }}
    >
      {problem && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setProblem(null)}>
          {problem.message}
          {problem.errors.length > 0 && (
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {problem.errors.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </Box>
          )}
        </Alert>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {published ? (
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Published
            </Typography>
          ) : (
            <Typography variant="body2" color={blockedReason ? 'text.secondary' : 'success.main'} role="status">
              {blockedReason ?? 'Ready to publish.'}
            </Typography>
          )}
          {showLive && (
            <Typography variant="body2" role="status" aria-live="polite" color={site.live ? 'success.main' : site.failed ? 'error.main' : 'text.secondary'} data-testid="live-status">
              {liveText}
            </Typography>
          )}
        </Box>
        {published ? (
          <Stack direction="row" spacing={1}>
            <Button component={Link} href={projectSiteUrl(project.slug)} target="_blank" rel="noopener noreferrer" variant="outlined" endIcon={<OpenInNewIcon />} sx={{ flex: 1, minHeight: 48 }}>
              View on site ↗
            </Button>
            <Button color="warning" variant="outlined" onClick={() => void run('unpublish')} disabled={busy} sx={{ flex: 1, minHeight: 48 }}>
              Unpublish
            </Button>
          </Stack>
        ) : (
          <Button variant="contained" size="large" onClick={() => setConfirming(true)} disabled={busy || blockedReason !== null} sx={{ minHeight: 48 }}>
            Publish
          </Button>
        )}
      </Stack>

      <Dialog open={confirming} onClose={() => !busy && setConfirming(false)} aria-labelledby="publish-confirm-title">
        <DialogTitle id="publish-confirm-title">Publish this project?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            It goes on the website after the next site update.
            {lint.warnings.length === 0 ? (
              <Typography sx={{ mt: 1 }}>No warnings.</Typography>
            ) : (
              <>
                <Typography sx={{ mt: 1 }}>
                  {lint.warnings.length} {lint.warnings.length === 1 ? 'warning' : 'warnings'} (you can still publish):
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {lint.warnings.map((warning, index) => (
                    <li key={index}>{warning.message}</li>
                  ))}
                </Box>
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)} disabled={busy}>
            Not yet
          </Button>
          <Button variant="contained" onClick={() => void run('publish')} disabled={busy} autoFocus>
            Publish now
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

