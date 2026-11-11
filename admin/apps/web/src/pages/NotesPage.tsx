import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Checkbox, Container, IconButton, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { usePlatformHost } from '@marinoscar/platform-web/core';

/** One note, as `GET /api/notes` returns it. */
export interface Note {
  id: string;
  title: string;
  body: string;
  archived: boolean;
}

/** The sample page: the signed-in user's notes, through the platform transport. */
export function NotesPage() {
  const { api, viewer } = usePlatformHost();
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canWrite = viewer.hasPermission('notes:write');

  const load = useCallback(async () => {
    try {
      setNotes(await api.get<Note[]>('/notes'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notes');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    await api.post('/notes', { title });
    setTitle('');
    await load();
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        My notes
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {canWrite && (
        <Box component="form" onSubmit={add}>
          <Stack direction="row" spacing={1}>
            <TextField label="New note" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" />
            <Button type="submit" variant="contained">
              Add
            </Button>
          </Stack>
        </Box>
      )}
      <List aria-label="Notes">
        {notes.map((note) => (
          <ListItem
            key={note.id}
            secondaryAction={
              canWrite && (
                <IconButton aria-label={`Delete ${note.title}`} onClick={() => void api.delete(`/notes/${note.id}`).then(load)}>
                  <DeleteOutlineIcon />
                </IconButton>
              )
            }
          >
            <Checkbox
              checked={note.archived}
              disabled={!canWrite}
              slotProps={{ input: { 'aria-label': `Archive ${note.title}` } }}
              onChange={(e) => void api.patch(`/notes/${note.id}`, { archived: e.target.checked }).then(load)}
            />
            <ListItemText primary={note.title} secondary={note.archived ? 'Archived' : undefined} />
          </ListItem>
        ))}
      </List>
      {notes.length === 0 && !error && <Typography color="text.secondary">No notes yet.</Typography>}
    </Container>
  );
}
