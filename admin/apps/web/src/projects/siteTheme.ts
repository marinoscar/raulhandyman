/**
 * The public site's frame tokens, copied from `src/styles/global.css` of the
 * site repository (navy/gold palette, 8px radius), so the crop previews look
 * like the real thing. Keep in sync by hand when the site's palette changes.
 */
export const SITE_THEME = {
  navy: '#0e1f3d',
  navy2: '#16294d',
  gold: '#b8862b',
  goldText: '#8a6219',
  goldBright: '#d6a84e',
  goldSoft: '#f1e6cc',
  bg: '#f7f6f2',
  surface: '#ffffff',
  ink: '#152036',
  muted: '#4f5a6b',
  line: '#dcd8cc',
  onNavy: '#f4efe3',
  radius: 8,
} as const;

/** The public site, for the Google result preview and "View on site". */
export const SITE_ORIGIN = 'https://raulhandyman.net';
export const SITE_HOST = 'raulhandyman.net';

/** The public URL of a project page. */
export const projectSiteUrl = (slug: string): string => `${SITE_ORIGIN}/projects/${slug}/`;
