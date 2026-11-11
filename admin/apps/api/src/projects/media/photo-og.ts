import { join } from 'node:path';
import sharp from 'sharp';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** The navy band covers the bottom 34% of the image. */
export const OG_BAND_HEIGHT = Math.round(OG_HEIGHT * 0.34);
export const OG_BAND_TOP = OG_HEIGHT - OG_BAND_HEIGHT;
export const OG_RULE_HEIGHT = 4;
export const OG_PADDING = 48;
export const OG_BAND_OPACITY = 0.92;

/**
 * Fraunces (SIL OFL 1.1), a static SemiBold instance of the variable
 * `@fontsource-variable/fraunces` latin file, registered under the family name
 * "Fraunces Static". Handed to sharp's text renderer as `fontfile`, so the OG
 * never depends on fonts installed in the container (and the alpine API image
 * needs no font package). See assets/fonts/Fraunces-OFL.txt.
 */
export const OG_FONT_FILE = join(__dirname, '..', '..', '..', 'assets', 'fonts', 'Fraunces-SemiBold.ttf');
const FONT_FAMILY = 'Fraunces Static';
const TITLE_SIZE = 44;
const SUBTITLE_SIZE = 28;
const TITLE_MAX_LINES = 2;
const LOGO_MAX = { width: 220, height: 96 };
const LOGO_GAP = 32;

export interface OgBrand {
  navy: string;
  gold: string;
  businessName: string;
  /** The logo image bytes, drawn at the right of the band, when set. */
  logo?: Buffer | null;
}

export interface OgInput {
  /** The unbranded `og` crop (any size; fitted to 1200x630). */
  crop: Buffer;
  title: string;
  /** Town display name, for example `Springfield`. The line reads `<town>, TX · <businessName>`. */
  town: string;
  brand: OgBrand;
}

function rgb(color: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) throw new Error(`Not a #rrggbb colour: ${color}`);
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const escapeMarkup = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function text(markup: string, size: number, width?: number): Promise<{ input: Buffer; width: number; height: number }> {
  const input = await sharp({
    text: {
      text: markup,
      font: `${FONT_FAMILY} ${size}`,
      fontfile: OG_FONT_FILE,
      rgba: true,
      dpi: 72,
      ...(width ? { width, wrap: 'word-char' as const } : { wrap: 'none' as const }),
    },
  })
    .png()
    .toBuffer();
  const meta = await sharp(input).metadata();
  return { input, width: meta.width ?? 0, height: meta.height ?? 0 };
}

const span = (color: string, body: string): string => `<span foreground="${color}">${escapeMarkup(body)}</span>`;

/** The title wrapped to at most two lines inside `maxWidth`, ellipsised when longer. */
async function fitTitle(title: string, maxWidth: number): Promise<{ input: Buffer; width: number; height: number }> {
  const lineHeight = (await text(span('#ffffff', 'Ag'), TITLE_SIZE)).height;
  const words = title.trim().split(/\s+/).filter(Boolean);
  let count = words.length;
  for (;;) {
    const candidate = words.slice(0, count).join(' ') + (count < words.length ? '…' : '');
    const rendered = await text(span('#ffffff', candidate), TITLE_SIZE, maxWidth);
    if (rendered.height <= lineHeight * (TITLE_MAX_LINES + 0.5) || count <= 1) {
      if (rendered.height > lineHeight * (TITLE_MAX_LINES + 0.5)) return fitTitleChars(words[0] ?? '', maxWidth, lineHeight);
      return rendered;
    }
    count -= 1;
  }
}

async function fitTitleChars(word: string, maxWidth: number, lineHeight: number): Promise<{ input: Buffer; width: number; height: number }> {
  let chars = word.length;
  for (;;) {
    const rendered = await text(span('#ffffff', word.slice(0, chars) + '…'), TITLE_SIZE, maxWidth);
    if (rendered.height <= lineHeight * (TITLE_MAX_LINES + 0.5) || chars <= 1) return rendered;
    chars -= 1;
  }
}

/** The second line, shortened with an ellipsis when it would exceed `maxWidth`. */
async function fitSubtitle(town: string, businessName: string, gold: string, maxWidth: number): Promise<{ input: Buffer; width: number; height: number }> {
  let name = businessName;
  for (;;) {
    const line = `${town}, TX · ${name}${name === businessName ? '' : '…'}`;
    const rendered = await text(span(gold, line), SUBTITLE_SIZE);
    if (rendered.width <= maxWidth || name.length <= 1) return rendered;
    name = name.slice(0, -1).trimEnd();
  }
}

/**
 * The branded OG image (1200x630 JPEG q85): the og crop with a navy band
 * (92% opacity, 4px gold top rule) over the bottom 34%, the project title in
 * Fraunces wrapped to two lines and ellipsised, `<Town>, TX · <businessName>`
 * below it in gold, and the logo at the right when one is set. All text stays
 * inside the band and its 48px side margins.
 */
export async function renderOgImage(input: OgInput): Promise<Buffer> {
  const navy = rgb(input.brand.navy);
  const gold = rgb(input.brand.gold);

  let logo: { input: Buffer; width: number; height: number } | null = null;
  if (input.brand.logo) {
    const { data, info } = await sharp(input.brand.logo).resize(LOGO_MAX.width, LOGO_MAX.height, { fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    logo = { input: data, width: info.width, height: info.height };
  }
  const textWidth = OG_WIDTH - 2 * OG_PADDING - (logo ? logo.width + LOGO_GAP : 0);

  const title = await fitTitle(input.title, textWidth);
  const subtitle = await fitSubtitle(input.town, input.brand.businessName, input.brand.gold, textWidth);

  const bandContentTop = OG_BAND_TOP + OG_RULE_HEIGHT;
  const subtitleTop = OG_HEIGHT - 24 - subtitle.height;
  const titleTop = Math.min(bandContentTop + 20, Math.max(bandContentTop + 4, subtitleTop - 8 - title.height));

  const band = await sharp({ create: { width: OG_WIDTH, height: OG_BAND_HEIGHT, channels: 4, background: { ...navy, alpha: OG_BAND_OPACITY } } })
    .png()
    .toBuffer();
  const rule = await sharp({ create: { width: OG_WIDTH, height: OG_RULE_HEIGHT, channels: 3, background: gold } }).png().toBuffer();

  const layers: sharp.OverlayOptions[] = [
    { input: band, left: 0, top: OG_BAND_TOP },
    { input: rule, left: 0, top: OG_BAND_TOP },
    { input: title.input, left: OG_PADDING, top: titleTop },
    { input: subtitle.input, left: OG_PADDING, top: subtitleTop },
  ];
  if (logo) layers.push({ input: logo.input, left: OG_WIDTH - OG_PADDING - logo.width, top: bandContentTop + Math.round((OG_BAND_HEIGHT - OG_RULE_HEIGHT - logo.height) / 2) });

  return sharp(input.crop)
    .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover' })
    .removeAlpha()
    .composite(layers)
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}
