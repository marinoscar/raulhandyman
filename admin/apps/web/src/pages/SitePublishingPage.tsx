import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, CircularProgress, FormControlLabel, Link, Slider, Stack, Switch, TextField, Typography } from '@mui/material';
import { usePlatformHost } from '@marinoscar/platform-web/core';
import { createStorageObjectsClient } from '@marinoscar/platform-web/storage/headless';

import { useIndexNowKey, useProjectsSettings, useSitePublishStatus, type ProjectsSettings } from '../projects/sitePublishing';

/** The warmth slider's range (the API accepts up to 0.3; the useful range is smaller). */
export const WARMTH_MAX = 0.15;
const SATURATION_RANGE = { min: 0.5, max: 1.5 };
const HEX = /^#[0-9a-fA-F]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A CSS approximation of the photo grade for the preview: warmth maps to `sepia()` and saturation
 * to `saturate()`. The real grade runs on the server (sharp) and looks different; this only shows
 * the direction and relative strength on a generated swatch, not a real photo.
 */
export function gradeFilter(warmth: number, saturation: number): string {
  return `sepia(${(warmth * 2.5).toFixed(3)}) saturate(${saturation.toFixed(2)})`;
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : 'never');

function BuildStatusCard() {
  const status = useSitePublishStatus();
  const s = status.data;
  const live = s !== undefined && s.contentVersion !== '' && s.lastBuildVersion === s.contentVersion;
  return (
    <Card component="section" aria-labelledby="sp-status">
      <CardContent>
        <Typography id="sp-status" variant="h6" component="h2" gutterBottom>
          Build status
        </Typography>
        {status.loading && !s && <CircularProgress size={24} aria-label="Loading build status" />}
        {status.error && <Alert severity="error">{status.error.message}</Alert>}
        {s && (
          <Stack spacing={0.5}>
            <Typography variant="body2">Content version: {s.contentVersion || 'none yet'}</Typography>
            <Typography variant="body2" data-testid="build-state">
              Last build: {s.lastBuildStatus ?? 'none'} {s.lastBuildAt ? `at ${when(s.lastBuildAt)}` : ''} {live ? '(site is up to date)' : s.contentVersion ? '(waiting for the next build)' : ''}
            </Typography>
            {s.lastBuildError && <Alert severity="error">Build error: {s.lastBuildError}</Alert>}
            <Typography variant="body2">
              Last IndexNow ping: {s.lastPing?.at ? `${when(s.lastPing.at)}, status ${s.lastPing.status ?? 'unknown'}, ${s.lastPing.urlCount ?? 0} URLs` : 'never'}
            </Typography>
            {s.lastPing?.error && <Alert severity="warning">Ping error: {s.lastPing.error}</Alert>}
          </Stack>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          How to set up the server: see docs/runbook-admin.md in the project repository.
        </Typography>
      </CardContent>
    </Card>
  );
}

function BuildTokenCard() {
  return (
    <Card component="section" aria-labelledby="sp-token">
      <CardContent>
        <Typography id="sp-token" variant="h6" component="h2" gutterBottom>
          Build token
        </Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>
          The website build reads published content with a personal access token. Set it up in three steps:
        </Typography>
        <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
          <li>
            <Typography variant="body2">
              Create a service user and give it only the <code>site_reader</code> role, in <Link component={RouterLink} to="/admin/settings/users">Users</Link>.
            </Typography>
          </li>
          <li>
            <Typography variant="body2">
              Create a personal access token for that user (as that user, on the <Link component={RouterLink} to="/settings/tokens">Tokens</Link> page). It is shown once, so copy it right away.
            </Typography>
          </li>
          <li>
            <Typography variant="body2">
              Save it on the VPS as <code>/opt/infra/apps/raulhandyman/.content-token</code> and run <code>chmod 600</code> on that file.
            </Typography>
          </li>
        </Box>
        <Alert severity="info" sx={{ mt: 2 }}>
          A personal access token cannot be limited to a single permission: it carries every permission of the user it belongs to. That is why the service user must hold only the <code>site_reader</code> role.
          Never create the token as your own admin account.
        </Alert>
      </CardContent>
    </Card>
  );
}

function IndexNowCard() {
  const key = useIndexNowKey();
  const [confirmClear, setConfirmClear] = useState(false);
  const k = key.data;
  return (
    <Card component="section" aria-labelledby="sp-indexnow">
      <CardContent>
        <Typography id="sp-indexnow" variant="h6" component="h2" gutterBottom>
          IndexNow
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          IndexNow tells search engines about changed pages. The key is public by design: the site serves it as <code>/&lt;key&gt;.txt</code> so search engines can check the ping is yours.
        </Typography>
        {key.error && <Alert severity="error">{key.error.message}</Alert>}
        {key.actionError && <Alert severity="error">{key.actionError}</Alert>}
        {k && (
          <Typography variant="body2" data-testid="indexnow-state" sx={{ mb: 1, wordBreak: 'break-all' }}>
            {k.configured ? `Key: ${k.key} (served at ${k.keyLocation})` : 'No key configured: pings are skipped.'}
          </Typography>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button variant="contained" onClick={() => void key.generate()} disabled={key.pending || !k} sx={{ minHeight: 44 }}>
            {k?.configured ? 'Generate new key' : 'Generate key'}
          </Button>
          {k?.configured &&
            (confirmClear ? (
              <Button
                color="warning"
                variant="outlined"
                onClick={() => {
                  setConfirmClear(false);
                  void key.clear();
                }}
                disabled={key.pending}
                sx={{ minHeight: 44 }}
              >
                Confirm clear key
              </Button>
            ) : (
              <Button color="warning" variant="outlined" onClick={() => setConfirmClear(true)} disabled={key.pending} sx={{ minHeight: 44 }}>
                Clear key
              </Button>
            ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** The two swatches of the grade preview: the same generated gradient, unfiltered and filtered. */
function GradePreview({ warmth, saturation }: { warmth: number; saturation: number }) {
  const sample = 'linear-gradient(135deg, #7da7c9 0%, #c9b79a 45%, #8a9a6b 75%, #b5654a 100%)';
  return (
    <Stack direction="row" spacing={2} aria-label="Photo look preview">
      {[
        { label: 'Before', filter: 'none', id: 'grade-preview-before' },
        { label: 'After', filter: gradeFilter(warmth, saturation), id: 'grade-preview-after' },
      ].map((item) => (
        <Box key={item.label} sx={{ flex: 1 }}>
          <Box data-testid={item.id} sx={{ height: 72, borderRadius: 1, backgroundImage: sample, filter: item.filter }} style={{ filter: item.filter }} />
          <Typography variant="caption">{item.label}</Typography>
        </Box>
      ))}
    </Stack>
  );
}

function BrandCard() {
  const { api, viewer } = usePlatformHost();
  const canWrite = viewer.hasPermission('system_settings:write');
  const settings = useProjectsSettings();
  const [form, setForm] = useState<ProjectsSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings.projects) setForm(settings.projects);
  }, [settings.projects]);

  const patch = (next: Partial<{ [K in keyof ProjectsSettings]: Partial<ProjectsSettings[K]> }>) => {
    setSaved(false);
    setForm((cur) => (cur ? { brand: { ...cur.brand, ...next.brand }, grade: { ...cur.grade, ...next.grade }, og: { ...cur.og, ...next.og } } : cur));
  };

  const invalid = form !== null && (!HEX.test(form.brand.navy) || !HEX.test(form.brand.gold) || form.brand.businessName.trim() === '' || (form.brand.logoObjectId !== null && !UUID.test(form.brand.logoObjectId)));

  const onSave = async () => {
    if (!form) return;
    setProblem(null);
    try {
      await settings.save({ brand: { ...form.brand, businessName: form.brand.businessName.trim() }, grade: form.grade, og: form.og });
      setSaved(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not save');
    }
  };

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setProblem(null);
    try {
      const object = await createStorageObjectsClient(api).uploadAndWait(file);
      patch({ brand: { logoObjectId: object.id } });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The logo could not be uploaded');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card component="section" aria-labelledby="sp-brand">
      <CardContent>
        <Typography id="sp-brand" variant="h6" component="h2" gutterBottom>
          Brand &amp; photo look
        </Typography>
        {settings.isLoading && !form && <CircularProgress size={24} aria-label="Loading brand settings" />}
        {settings.error && !form && <Alert severity="error">{settings.error}</Alert>}
        {form && (
          <Stack spacing={2}>
            {!canWrite && <Alert severity="info">Read-only: changing these values needs the system_settings:write permission.</Alert>}
            <TextField label="Business name" value={form.brand.businessName} onChange={(e) => patch({ brand: { businessName: e.target.value } })} disabled={!canWrite} slotProps={{ htmlInput: { maxLength: 80 } }} />
            <TextField label="Phone (as shown)" value={form.brand.phoneDisplay} onChange={(e) => patch({ brand: { phoneDisplay: e.target.value } })} disabled={!canWrite} slotProps={{ htmlInput: { maxLength: 40 } }} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {(['navy', 'gold'] as const).map((name) => (
                <Stack key={name} direction="row" spacing={1} sx={{ flex: 1, alignItems: 'center' }}>
                  <input
                    type="color"
                    aria-label={`${name === 'navy' ? 'Navy' : 'Gold'} colour picker`}
                    value={HEX.test(form.brand[name]) ? form.brand[name] : '#000000'}
                    onChange={(e) => patch({ brand: { [name]: e.target.value } })}
                    disabled={!canWrite}
                    style={{ width: 44, height: 44, padding: 0, border: 0, background: 'none' }}
                  />
                  <TextField
                    label={name === 'navy' ? 'Navy' : 'Gold'}
                    value={form.brand[name]}
                    onChange={(e) => patch({ brand: { [name]: e.target.value } })}
                    disabled={!canWrite}
                    error={!HEX.test(form.brand[name])}
                    helperText={HEX.test(form.brand[name]) ? undefined : 'Use #rrggbb'}
                    fullWidth
                  />
                </Stack>
              ))}
            </Stack>
            <Stack spacing={1}>
              <TextField
                label="Logo object id"
                value={form.brand.logoObjectId ?? ''}
                onChange={(e) => patch({ brand: { logoObjectId: e.target.value.trim() === '' ? null : e.target.value.trim() } })}
                disabled={!canWrite}
                helperText="The storage object of the logo drawn on the branded share image. Empty for none."
                error={form.brand.logoObjectId !== null && !UUID.test(form.brand.logoObjectId)}
              />
              {canWrite && (
                <>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Logo file" onChange={(e) => void onLogo(e.target.files?.[0])} />
                  <Button variant="outlined" onClick={() => fileRef.current?.click()} disabled={uploading} sx={{ alignSelf: 'flex-start', minHeight: 44 }}>
                    {uploading ? 'Uploading…' : 'Upload logo'}
                  </Button>
                </>
              )}
            </Stack>
            <Box>
              <Typography id="warmth-label" variant="body2">
                Warmth: {form.grade.warmth.toFixed(3)}
              </Typography>
              <Slider
                aria-labelledby="warmth-label"
                min={0}
                max={Math.max(WARMTH_MAX, form.grade.warmth)}
                step={0.005}
                value={form.grade.warmth}
                onChange={(_, value) => patch({ grade: { warmth: value as number } })}
                disabled={!canWrite}
              />
              <Typography id="saturation-label" variant="body2">
                Saturation: {form.grade.saturation.toFixed(2)}
              </Typography>
              <Slider
                aria-labelledby="saturation-label"
                min={SATURATION_RANGE.min}
                max={SATURATION_RANGE.max}
                step={0.01}
                value={form.grade.saturation}
                onChange={(_, value) => patch({ grade: { saturation: value as number } })}
                disabled={!canWrite}
              />
              <GradePreview warmth={form.grade.warmth} saturation={form.grade.saturation} />
              <Typography variant="caption" color="text.secondary">
                A rough preview on a sample swatch; the real grade is applied to each photo when it is processed.
              </Typography>
            </Box>
            <FormControlLabel
              control={<Switch checked={form.og.enabled} onChange={(e) => patch({ og: { enabled: e.target.checked } })} disabled={!canWrite} />}
              label="Brand the share image (OG) with the business name and phone"
            />
            {problem && <Alert severity="error">{problem}</Alert>}
            {saved && <Alert severity="success">Saved. New values apply to the next processed photo.</Alert>}
            {canWrite && (
              <Button variant="contained" onClick={() => void onSave()} disabled={settings.isSaving || invalid} sx={{ alignSelf: 'flex-start', minHeight: 44 }}>
                Save
              </Button>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/** `/admin/settings/site-publishing` (card permission `projects:publish`; the brand writes need `system_settings:write`). */
export function SitePublishingPage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h4" component="h1">
          Site publishing
        </Typography>
        <Typography color="text.secondary">The website build, its access token, search engine pings and the brand values.</Typography>
      </Box>
      <BuildStatusCard />
      <BuildTokenCard />
      <IndexNowCard />
      <BrandCard />
    </Stack>
  );
}
