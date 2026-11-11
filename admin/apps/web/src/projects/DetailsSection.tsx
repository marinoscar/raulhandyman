import { FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';

import type { Draft } from './editor';
import type { Catalog } from './types';

export interface DetailsSectionProps {
  draft: Draft;
  catalog: Catalog | undefined;
  disabled?: boolean;
  onChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}

/** Service, town, completion date, featured and the private work notes. */
export function DetailsSection({ draft, catalog, disabled, onChange }: DetailsSectionProps) {
  return (
    <Stack spacing={2}>
      <TextField
        select
        id="field-serviceSlug"
        label="Service"
        value={catalog ? draft.serviceSlug : ''}
        onChange={(event) => onChange('serviceSlug', event.target.value)}
        disabled={disabled || !catalog}
        fullWidth
      >
        {catalog?.services.map((service) => (
          <MenuItem key={service.slug} value={service.slug}>
            {service.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        id="field-townSlug"
        label="Town"
        value={catalog ? draft.townSlug : ''}
        onChange={(event) => onChange('townSlug', event.target.value)}
        disabled={disabled || !catalog}
        fullWidth
      >
        {catalog?.towns.map((town) => (
          <MenuItem key={town.slug} value={town.slug}>
            {town.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        id="field-completedOn"
        label="Completed on"
        type="date"
        value={draft.completedOn}
        onChange={(event) => onChange('completedOn', event.target.value)}
        disabled={disabled}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <FormControlLabel
        control={<Switch checked={draft.featured} onChange={(event) => onChange('featured', event.target.checked)} disabled={disabled} />}
        label="Featured on the home page"
      />
      <TextField
        id="field-workNotes"
        label="Work notes"
        value={draft.workNotes}
        onChange={(event) => onChange('workNotes', event.target.value)}
        disabled={disabled}
        multiline
        minRows={4}
        fullWidth
        helperText="Private. What did you do? Materials, problem, result. AI uses this — it never invents details."
      />
    </Stack>
  );
}
