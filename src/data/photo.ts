// Image delivery in one place (issue #35): AVIF + WebP + JPEG fallback, per-format quality,
// widths trimmed to the source. AVIF 50 (not 55): on a real portrait it is ~30% smaller than WebP 72 with no visible loss. Used by Photo.astro and by pages that preload their LCP image.
import { getImage } from 'astro:assets';

export const PHOTO_WIDTHS = [480, 800, 1200, 1600];
export const PHOTO_QUALITY = { avif: 50, webp: 72, jpg: 78 } as const;
type Fmt = keyof typeof PHOTO_QUALITY;
const MIME: Record<Fmt, string> = { avif: 'image/avif', webp: 'image/webp', jpg: 'image/jpeg' };

export interface PhotoDelivery {
  sources: { type: string; srcset: string }[];
  img: { src: string; srcset: string; width: number; height: number };
}

/** Requested widths that fit inside the source; a source narrower than all of them is served as is. */
export function fitWidths(src: ImageMetadata, widths: number[] = PHOTO_WIDTHS): number[] {
  const fit = [...new Set(widths.filter((w) => w <= src.width))].sort((a, b) => a - b);
  return fit.length ? fit : [src.width];
}

export async function deliverPhoto(src: ImageMetadata, widths?: number[]): Promise<PhotoDelivery> {
  const ws = fitWidths(src, widths);
  const built = await Promise.all(
    (['avif', 'webp', 'jpg'] as Fmt[]).map(async (format) => {
      const r = await getImage({ src, widths: ws, format, quality: PHOTO_QUALITY[format] });
      return { format, srcset: r.srcSet.attribute };
    }),
  );
  const fallback = await getImage({ src, width: ws.find((w) => w >= 800) ?? ws[ws.length - 1], format: 'jpg', quality: PHOTO_QUALITY.jpg });
  return {
    sources: built.filter((b) => b.format !== 'jpg').map((b) => ({ type: MIME[b.format], srcset: b.srcset })),
    img: { src: fallback.src, srcset: built.find((b) => b.format === 'jpg')!.srcset, width: src.width, height: src.height },
  };
}

/** The `preloadImage` prop of Base.astro for an LCP photo (AVIF candidates). */
export async function preloadFor(src: ImageMetadata, sizes: string, widths?: number[]) {
  const d = await deliverPhoto(src, widths);
  const avif = d.sources[0];
  return { href: avif.srcset.split(' ')[0], srcset: avif.srcset, sizes, type: avif.type };
}
