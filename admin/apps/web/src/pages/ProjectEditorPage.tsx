import { useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, LinearProgress, Link, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { usePlatformHost } from '@marinoscar/platform-web/core';
import { lintProject } from '@app/shared/seo-lint';

import { CopySection, AiWarnings } from '../projects/CopySection';
import { DetailsSection } from '../projects/DetailsSection';
import { ProjectPhotosSection } from '../projects/ProjectPhotosSection';
import { PublishBar } from '../projects/PublishBar';
import { SeoPanel } from '../projects/SeoPanel';
import { useProjectEditor, type SaveState } from '../projects/editor';
import { useAiAvailability, useCatalog } from '../projects/hooks';
import type { PhotoCopyOutput } from '../projects/types';
import { photoSuggestionOf } from '../projects/PhotoCard';
import { focusById } from '../projects/textUtils';
import type { ApplyBody, ApplyProjectField, LintIssue, LintResult, Project } from '../projects/types';
import type { UploadDeps } from '../projects/upload';

type SectionKey = 'details' | 'copy' | 'photos' | 'seo';

const SAVE_TEXT: Record<SaveState, string> = { saved: 'Saved ✓', saving: 'Saving…', unsaved: 'Unsaved', error: 'Not saved' };
const SIBLING_CODES = new Set(['slug.duplicate', 'title.duplicate', 'meta.duplicate']);

const sectionOf = (issue: LintIssue): SectionKey => {
  if (issue.photoId || issue.field === 'coverPhotoId' || issue.field === 'photos') return 'photos';
  if (issue.field === 'completedOn' || issue.field === 'serviceSlug' || issue.field === 'townSlug') return 'details';
  return 'copy';
};

function Section({ id, title, expanded, onToggle, children }: { id: SectionKey; title: string; expanded: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <Accordion expanded={expanded} onChange={(_, open) => onToggle(open)} disableGutters slotProps={{ transition: { unmountOnExit: false } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} id={`section-${id}-header`} aria-controls={`section-${id}`}>
        <Typography variant="h6" component="h2" id={id === 'photos' ? 'photos-section-heading' : undefined} tabIndex={id === 'photos' ? -1 : undefined}>
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails id={`section-${id}`}>{children}</AccordionDetails>
    </Accordion>
  );
}

export interface ProjectEditorPageProps {
  /** Injectable for tests. */
  uploaderDeps?: UploadDeps;
}

/** `/projects/:id`: details, copy, photos and SEO, with autosave and the AI suggestions. */
export function ProjectEditorPage(props: ProjectEditorPageProps) {
  const { id } = useParams<{ id: string }>();
  return id ? <Editor key={id} id={id} {...props} /> : null;
}

function Editor({ id, uploaderDeps }: { id: string } & ProjectEditorPageProps) {
  const { viewer } = usePlatformHost();
  const canWrite = viewer.hasPermission('projects:write');
  const canPublish = viewer.hasPermission('projects:publish');
  const editor = useProjectEditor(id);
  const catalog = useCatalog();
  const ai = useAiAvailability();
  const { project, draft } = editor;
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({ details: true, copy: true, photos: true, seo: true });
  const [titleOption, setTitleOption] = useState<0 | 1 | 2>(0);

  const lint = useMemo<LintResult | null>(() => {
    if (!project || !draft) return null;
    const live = lintProject(
      { id: project.id, title: draft.title, seoTitle: draft.seoTitle, metaDescription: draft.metaDescription, slug: draft.slug, body: draft.body, coverPhotoId: project.coverPhotoId, serviceSlug: draft.serviceSlug, townSlug: draft.townSlug, completedOn: draft.completedOn || null },
      project.photos,
      [],
      catalog.data,
    );
    // The browser does not hold the other projects, so duplicates come from the server's own lint of the saved values.
    const fromServer = (project.lint?.errors ?? []).filter((issue) => SIBLING_CODES.has(issue.code) && draft[issue.field as 'slug' | 'title' | 'metaDescription'] === project[issue.field as 'slug' | 'title' | 'metaDescription']);
    if (fromServer.length === 0) return live;
    const errors = [...live.errors, ...fromServer];
    return { ...live, errors, score: Math.max(0, live.score - fromServer.length * 12) };
  }, [project, draft, catalog.data]);

  if (editor.error && !project) {
    return (
      <Alert severity="error">{editor.error.status === 404 ? 'This project does not exist (or was deleted).' : `Could not load the project. ${editor.error.message}`}</Alert>
    );
  }
  if (!project || !draft || !lint) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '40vh' }}>
        <CircularProgress aria-label="Loading project" />
      </Box>
    );
  }

  const goToField = (issue: LintIssue) => {
    const section = sectionOf(issue);
    setExpanded((current) => ({ ...current, [section]: true }));
    // Wait a frame so a just-opened section is visible before it is focused.
    window.setTimeout(() => {
      const fieldId = issue.photoId
        ? issue.field === 'altText'
          ? `photo-alt-${issue.photoId}`
          : issue.field === 'caption'
            ? `photo-caption-${issue.photoId}`
            : `photo-card-${issue.photoId}`
        : issue.field === 'coverPhotoId' || issue.field === 'photos'
          ? 'photos-section-heading'
          : `field-${issue.field}`;
      focusById(fieldId);
    }, 60);
  };

  const cover = project.photos.find((photo) => photo.id === project.coverPhotoId);
  const suggestion = project.aiSuggestion?.output;
  const photoSuggestions = project.photos.flatMap((photo) => {
    const s: PhotoCopyOutput | null = photoSuggestionOf(photo);
    const fields = (['altText', 'caption', 'fileSlug'] as const).filter((field) => s?.[field] && s[field] !== photo[field]);
    return fields.length > 0 ? [{ photoId: photo.id, fields: [...fields] }] : [];
  });
  const published = project.status === 'published';
  const applyAll = () => {
    const fields: ApplyProjectField[] = (['title', 'slug', 'seoTitle', 'metaDescription', 'summary', 'body'] as const).filter((field) => {
      if (!suggestion) return false;
      if (field === 'title') return suggestion.titleOptions.length > 0;
      // A published project keeps its address unless the editor unlocks the slug by hand.
      return field !== 'slug' || !published;
    });
    const body: ApplyBody = { project: fields, titleOption, ...(photoSuggestions.length > 0 ? { photos: photoSuggestions } : {}) };
    void editor.apply(body);
  };

  const copyAi = {
    available: ai.available,
    reason: ai.reason,
    busy: editor.aiPending,
    onUse: (field: ApplyProjectField, option?: 0 | 1 | 2) => void editor.apply({ project: [field], ...(field === 'title' ? { titleOption: option ?? titleOption } : {}) }),
    onAnother: (body: Parameters<typeof editor.regenerate>[0]) => void editor.regenerate(body),
  };
  const hasAnySuggestion = Boolean(suggestion) || photoSuggestions.length > 0;
  const disabled = !canWrite;
  const toggle = (key: SectionKey) => (open: boolean) => setExpanded((current) => ({ ...current, [key]: open }));

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Link component={RouterLink} to="/projects" underline="hover" variant="body2">
        ← All projects
      </Link>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, mb: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>
            {draft.title.trim() || 'Untitled project'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
            <Chip size="small" label={project.status === 'published' ? 'Published' : project.status === 'archived' ? 'Archived' : 'Draft'} color={published ? 'success' : 'default'} />
            <Typography variant="body2" color={editor.saveState === 'error' ? 'error' : 'text.secondary'} role="status" aria-live="polite">
              {SAVE_TEXT[editor.saveState]}
            </Typography>
          </Stack>
        </Box>
        {canWrite && (
          <Tooltip title={ai.available ? '' : (ai.reason ?? '')}>
            <span>
              <Button variant="contained" color="secondary" onClick={() => void editor.suggest()} disabled={!ai.available || editor.aiPending} sx={{ minHeight: 48, width: { xs: '100%', sm: 'auto' } }}>
                ✨ Suggest with AI
              </Button>
            </span>
          </Tooltip>
        )}
      </Stack>

      {editor.saveError && (
        <Alert severity="error" sx={{ mb: 2 }} role="alert">
          {editor.saveError}
        </Alert>
      )}
      {editor.aiError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={editor.clearAiError}>
          {editor.aiError}
        </Alert>
      )}
      {editor.aiPending && (
        <Box sx={{ mb: 2 }} role="status">
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            The AI is writing a draft from your photos and notes…
          </Typography>
          <LinearProgress aria-label="AI suggestion in progress" />
        </Box>
      )}
      <AiWarnings warnings={suggestion?.warnings} />
      {hasAnySuggestion && canWrite && (
        <Alert severity="success" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={applyAll} disabled={editor.aiPending}>Apply all</Button>}>
          The AI drafted copy for this project. Nothing changes until you use it.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Section id="details" title="Details" expanded={expanded.details} onToggle={toggle('details')}>
            <DetailsSection draft={draft} catalog={catalog.data} disabled={disabled} onChange={editor.setField} />
          </Section>
          <Section id="copy" title="Copy" expanded={expanded.copy} onToggle={toggle('copy')}>
            <CopySection draft={draft} project={project} ai={copyAi} disabled={disabled} titleOption={titleOption} onTitleOptionChange={setTitleOption} onChange={editor.setField} />
          </Section>
        </Stack>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Section id="photos" title="Photos" expanded={expanded.photos} onToggle={toggle('photos')}>
            <ProjectPhotosSection project={project as Project} editor={editor} ai={ai} canWrite={canWrite} {...(uploaderDeps ? { uploaderDeps } : {})} />
          </Section>
          <Section id="seo" title="SEO and sharing" expanded={expanded.seo} onToggle={toggle('seo')}>
            <SeoPanel
              title={draft.title}
              seoTitle={draft.seoTitle}
              metaDescription={draft.metaDescription}
              summary={draft.summary}
              slug={draft.slug}
              lint={lint}
              ogImageUrl={cover?.previews?.ogBranded ?? cover?.previews?.og ?? null}
              onGoToField={goToField}
            />
          </Section>
        </Stack>
      </Box>

      {canPublish && (
        <PublishBar
          project={project}
          lint={lint}
          saveState={editor.saveState}
          prepare={async () => {
            await editor.flushAll();
            return editor.getVersion();
          }}
          onConflict={editor.handleConflict}
          onChanged={(result) => editor.setProject((prev) => (prev ? { ...prev, status: result.status, version: result.version, publishedAt: result.publishedAt, updatedAt: result.updatedAt } : prev))}
        />
      )}

      <Snackbar open={editor.notice !== null} autoHideDuration={8000} onClose={editor.dismissNotice} message={editor.notice ?? ''} />
    </Box>
  );
}
