// "The website build failed" for administrators. The raiser is the site build
// status route (`SiteEventsPublisher.publishBuildFailed`). The body carries the
// content version and a short error excerpt the build reported; never project
// notes, copy or tokens.
import {
  TRANSACTIONAL_EMAIL_HEADERS,
  html,
  plainText,
  renderLayout,
  resolveEmailRenderContext,
  type EmailRenderContext,
  type RenderedEmail,
} from '@marinoscar/platform-api/email';

export interface SiteBuildFailedEmailData {
  /** The content version the failed build was made from. */
  contentVersion: string;
  /** A short excerpt of the error the build reported. */
  error?: string;
  /** Absolute URL of the Site publishing page; the layout omits the button without it. */
  statusUrl?: string;
}

export function siteBuildFailedEmail(data: SiteBuildFailedEmailData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const version = data.contentVersion.slice(0, 12);
  const sentence = `The website build for content version ${version} failed, so the public site is not showing the latest changes.`;
  const detail = data.error ? `Error: ${data.error}` : 'The build reported no error text.';
  const bodyHtml = html`<p style="margin:0 0 16px 0;">${sentence}</p>
    <p style="margin:0;">${detail}</p>`;
  return {
    subject: `The website build failed on ${context.appName}`,
    html: renderLayout(
      { title: 'Website build failed', previewText: sentence, bodyHtml, ctaLabel: data.statusUrl ? 'Open Site publishing' : undefined, ctaUrl: data.statusUrl },
      context,
    ),
    text: plainText(
      { title: 'Website build failed', lines: [sentence, detail], ctaLabel: data.statusUrl ? 'Open Site publishing' : undefined, ctaUrl: data.statusUrl },
      context,
    ),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}
