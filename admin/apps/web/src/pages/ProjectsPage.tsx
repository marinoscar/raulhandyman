import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Alert, Avatar, Box, Chip, Fab, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import { usePlatformHost } from '@marinoscar/platform-web/core';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import type { DataTableColumn } from '@marinoscar/platform-web/datatable/headless';

import { NewProjectDialog } from '../projects/NewProjectDialog';
import { useCatalog, useProjects } from '../projects/hooks';
import type { ProjectFilters, ProjectStatus, ProjectSummary } from '../projects/types';

const STATUS_LABEL: Record<ProjectStatus, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' };
const STATUS_COLOR: Record<ProjectStatus, 'default' | 'success' | 'warning'> = { draft: 'default', published: 'success', archived: 'warning' };

const SEARCH_DEBOUNCE_MS = 400;
export const EMPTY_PROJECTS_TEXT = 'No projects yet — take a few photos of your next job and add it here.';

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** `/projects`: every project and its state, with a one-thumb "New project" action. */
export function ProjectsPage() {
  const { viewer } = usePlatformHost();
  const navigate = useNavigate();
  const canWrite = viewer.hasPermission('projects:write');
  const [filters, setFilters] = useState<ProjectFilters>({ page: 1, pageSize: 20 });
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  // The search applies a moment after typing stops.
  useEffect(() => {
    if ((filters.q ?? '') === search) return;
    const timer = window.setTimeout(() => setFilters((current) => ({ ...current, q: search, page: 1 })), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, filters.q]);
  const projects = useProjects(filters);
  const catalog = useCatalog();

  const serviceName = (slug: string) => catalog.data?.services.find((service) => service.slug === slug)?.name ?? slug;
  const townName = (slug: string) => catalog.data?.towns.find((town) => town.slug === slug)?.name ?? slug;

  const columns = useMemo<DataTableColumn<ProjectSummary>[]>(
    () => [
      {
        id: 'cover',
        label: 'Cover',
        priority: 'secondary',
        hideable: false,
        exportable: false,
        width: 72,
        render: (row) => (
          <Avatar variant="rounded" src={row.coverThumbUrl ?? undefined} alt="" slotProps={{ img: { loading: 'lazy' } }} sx={{ width: 56, height: 42 }}>
            <ImageOutlinedIcon />
          </Avatar>
        ),
      },
      {
        id: 'title',
        label: 'Title',
        priority: 'primary',
        flex: 1,
        minWidth: 200,
        value: (row) => row.title || 'Untitled project',
        render: (row) => (
          <Link component={RouterLink} to={`/projects/${row.id}`} underline="hover" sx={{ fontWeight: 600 }}>
            {row.title || 'Untitled project'}
          </Link>
        ),
      },
      { id: 'service', label: 'Service', priority: 'secondary', value: (row) => serviceName(row.serviceSlug), minWidth: 160 },
      { id: 'town', label: 'Town', priority: 'secondary', value: (row) => townName(row.townSlug), minWidth: 120 },
      {
        id: 'status',
        label: 'Status',
        priority: 'primary',
        value: (row) => STATUS_LABEL[row.status],
        render: (row) => <Chip size="small" color={STATUS_COLOR[row.status]} label={STATUS_LABEL[row.status]} />,
      },
      {
        id: 'lint',
        label: 'SEO',
        priority: 'secondary',
        value: (row) => (row.lintErrorCount == null ? '' : row.lintErrorCount === 0 ? '✔' : `${row.lintErrorCount} errors`),
        render: (row) =>
          row.lintErrorCount == null ? null : row.lintErrorCount === 0 ? (
            <Chip size="small" color="success" variant="outlined" label="✔" aria-label="No SEO errors" />
          ) : (
            <Chip size="small" color="error" variant="outlined" label={`${row.lintErrorCount} ${row.lintErrorCount === 1 ? 'error' : 'errors'}`} />
          ),
      },
      { id: 'updated', label: 'Updated', priority: 'detail', value: (row) => formatDay(row.updatedAt), minWidth: 130 },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.data],
  );

  const setFilter = (change: Partial<ProjectFilters>) => setFilters((current) => ({ ...current, ...change, page: change.page ?? 1 }));
  const data = projects.data;

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', pb: 10 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Projects
      </Typography>
      <Stack
        component="form"
        role="search"
        aria-label="Filter projects"
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        onSubmit={(event) => event.preventDefault()}
        sx={{ mb: 2 }}
      >
        <TextField
          size="small"
          label="Search projects"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          slotProps={{ htmlInput: { enterKeyHint: 'search' } }}
          sx={{ flex: 1 }}
        />
        <TextField select size="small" label="Status" value={filters.status ?? ''} onChange={(event) => setFilter({ status: event.target.value as ProjectStatus | '' })} sx={{ minWidth: 150 }}>
          <MenuItem value="">All statuses</MenuItem>
          {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((status) => (
            <MenuItem key={status} value={status}>
              {STATUS_LABEL[status]}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Service" value={filters.service ?? ''} onChange={(event) => setFilter({ service: event.target.value })} sx={{ minWidth: 200 }}>
          <MenuItem value="">All services</MenuItem>
          {catalog.data?.services.map((service) => (
            <MenuItem key={service.slug} value={service.slug}>
              {service.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {projects.error && !data && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {projects.error.status === 403 ? "You don't have access to projects." : `Could not load projects. ${projects.error.message}`}
        </Alert>
      )}

      <DataTable<ProjectSummary>
        tableId="projects"
        ariaLabel="Projects"
        columns={columns}
        rows={data?.items ?? []}
        rowId={(row) => row.id}
        loading={projects.loading && !data}
        disableExport
        pagination={{
          page: filters.page - 1,
          pageSize: filters.pageSize,
          total: data?.total ?? 0,
          // DataTable pages are zero-based; the API's are one-based.
          onPaginationChange: ({ page, pageSize }) => setFilters((current) => ({ ...current, page: page + 1, pageSize })),
        }}
        emptyState={
          <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            {filters.status || filters.service || filters.q ? 'No projects match these filters.' : EMPTY_PROJECTS_TEXT}
          </Typography>
        }
      />

      {canWrite && (
        <>
          <Fab
            variant="extended"
            color="primary"
            onClick={() => setCreating(true)}
            sx={{ position: 'fixed', right: 16, bottom: { xs: 80, sm: 24 }, zIndex: (theme) => theme.zIndex.speedDial }}
          >
            <AddIcon sx={{ mr: 1 }} />
            New project
          </Fab>
          <NewProjectDialog open={creating} onClose={() => setCreating(false)} onCreated={(project) => navigate(`/projects/${project.id}`)} />
        </>
      )}
    </Box>
  );
}
