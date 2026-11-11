import { useState, type FormEvent } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';

import { useCatalog, useCreateProject } from './hooks';
import type { ProjectSummary } from './types';

export interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectSummary) => void;
}

/** Starts a draft project from a service, a town and optional notes. */
export function NewProjectDialog({ open, onClose, onCreated }: NewProjectDialogProps) {
  const catalog = useCatalog();
  const { create, pending, error } = useCreateProject();
  const [serviceSlug, setServiceSlug] = useState('');
  const [townSlug, setTownSlug] = useState('');
  const [notes, setNotes] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const project = await create({ serviceSlug, townSlug, ...(notes.trim() ? { workNotes: notes.trim() } : {}) });
    if (project) onCreated(project);
  };

  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="new-project-title">
      <form onSubmit={submit}>
        <DialogTitle id="new-project-title">New project</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {catalog.error && <Alert severity="error">Could not load the services and towns. {catalog.error.message}</Alert>}
            {error && <Alert severity="error">{error}</Alert>}
            <TextField select required label="Service" value={serviceSlug} onChange={(event) => setServiceSlug(event.target.value)} disabled={!catalog.data} fullWidth>
              {catalog.data?.services.map((service) => (
                <MenuItem key={service.slug} value={service.slug}>
                  {service.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select required label="Town" value={townSlug} onChange={(event) => setTownSlug(event.target.value)} disabled={!catalog.data} fullWidth>
              {catalog.data?.towns.map((town) => (
                <MenuItem key={town.slug} value={town.slug}>
                  {town.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Notes (optional)"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              multiline
              minRows={3}
              fullWidth
              helperText="Private. What did you do? Materials, problem, result."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={pending || !serviceSlug || !townSlug}>
            Create project
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
