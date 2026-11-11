import { Box, Button, Chip, Stack, Typography } from '@mui/material';

export interface SuggestionChipProps {
  /** What the field is called, for the accessible names ("Use suggested SEO title"). */
  label: string;
  value: string;
  onUse: () => void;
  onAnother?: () => void;
  /** Why "Another option" is unavailable (AI off), shown as its title. */
  anotherDisabledReason?: string | null;
  busy?: boolean;
}

/** An AI suggestion under a field: a "Suggestion" chip, the proposed value, and Use / Another option. */
export function SuggestionChip({ label, value, onUse, onAnother, anotherDisabledReason, busy }: SuggestionChipProps) {
  return (
    <Box
      role="group"
      aria-label={`Suggestion for ${label}`}
      sx={{ mt: 0.5, mb: 1.5, p: 1, borderRadius: 1, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Chip size="small" color="secondary" variant="outlined" label="Suggestion" />
        <Typography variant="body2" sx={{ flex: '1 1 12rem', minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
          {value}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
        <Button size="small" variant="contained" onClick={onUse} aria-label={`Use suggested ${label}`} disabled={busy}>
          Use
        </Button>
        {onAnother && (
          <span title={anotherDisabledReason ?? undefined}>
            <Button size="small" onClick={onAnother} aria-label={`Another option for ${label}`} disabled={busy || Boolean(anotherDisabledReason)}>
              Another option
            </Button>
          </span>
        )}
      </Stack>
    </Box>
  );
}
