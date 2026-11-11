import { Fragment, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

export type MeasureText = (text: string, font: string) => number;

let canvas: HTMLCanvasElement | null | undefined;

/** Width of `text` in `font` using canvas `measureText`; an average-glyph estimate where canvas is unavailable (tests, old browsers). */
export const measureTextWidth: MeasureText = (text, font) => {
  try {
    if (canvas === undefined && typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
    }
    const context = canvas?.getContext?.('2d');
    if (context) {
      context.font = font;
      return context.measureText(text).width;
    }
  } catch {
    /* fall through to the estimate */
  }
  const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '16');
  return text.length * size * 0.5;
};

/** `text` cut with an ellipsis so it measures at most `maxPx` in `font` (binary search; the text itself when it fits). */
export function truncateToWidth(text: string, maxPx: number, font: string, measure: MeasureText = measureTextWidth): { text: string; truncated: boolean } {
  if (measure(text, font) <= maxPx) return { text, truncated: false };
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, mid).trimEnd()}…`, font) <= maxPx) low = mid;
    else high = mid - 1;
  }
  return { text: `${text.slice(0, low).trimEnd()}…`, truncated: true };
}

/** Scrolls to and focuses an element by id; resolves to whether it was found. */
export function focusById(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  element.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  element.focus({ preventScroll: true });
  return true;
}

// ----- a small, safe markdown preview (headings, lists, paragraphs, bold, italic; no raw HTML) -----

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** Renders the project body's markdown as React nodes (never HTML), so the preview cannot inject markup. */
export function MarkdownPreview({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/).filter((block) => block.trim() !== '');
  if (blocks.length === 0) return <Typography color="text.secondary">Nothing to preview yet.</Typography>;
  return (
    <Box data-testid="markdown-preview">
      {blocks.map((block, index) => {
        const heading = /^(#{1,6})\s+(.*)$/.exec(block);
        if (heading) {
          return (
            <Typography key={index} variant="h6" component="h3" sx={{ mt: 1.5 }}>
              {inline(heading[2]!)}
            </Typography>
          );
        }
        const lines = block.split('\n');
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <Box component="ul" key={index} sx={{ pl: 3, my: 1 }}>
              {lines.map((line, i) => (
                <li key={i}>{inline(line.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </Box>
          );
        }
        return (
          <Typography key={index} sx={{ my: 1 }}>
            {inline(lines.join(' '))}
          </Typography>
        );
      })}
    </Box>
  );
}
