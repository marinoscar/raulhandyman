// The minimal example of an app email template: "your notes were archived".
// The sample feature's archive job raises it through the notifications slice
// (`notes.archived`); a feature can also render it directly with
// `renderEmailTemplate('notes-archived', data)`.
//
// A template is a pure function from typed data to `{ subject, html, text,
// headers }`. Every interpolation goes through the escaping `html` tag; the
// subject is a header no escaping protects, so user text stays out of it.
import {
  TRANSACTIONAL_EMAIL_HEADERS,
  html,
  plainText,
  renderLayout,
  resolveEmailRenderContext,
  type EmailRenderContext,
  type RenderedEmail,
} from '@marinoscar/platform-api/email';

/** Everything the template renders. No ids, no note text. */
export interface NotesArchivedEmailData {
  /** How many of the recipient's notes were archived. */
  count: number;
  /** Absolute URL of the notes page; the layout omits the button without it. */
  notesUrl?: string;
}

/** Render the "notes archived" message. */
export function notesArchivedEmail(data: NotesArchivedEmailData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const noun = data.count === 1 ? 'note was' : 'notes were';
  const sentence = `${data.count} of your ${noun} archived because nobody edited ${data.count === 1 ? 'it' : 'them'} for a while.`;
  const bodyHtml = html`<p style="margin:0 0 16px 0;">${sentence}</p>
    <p style="margin:0;">Archived notes are kept: open the notes page to restore any of them.</p>`;
  return {
    subject: `Some of your notes were archived on ${context.appName}`,
    html: renderLayout(
      { title: 'Notes archived', previewText: sentence, bodyHtml, ctaLabel: data.notesUrl ? 'Open notes' : undefined, ctaUrl: data.notesUrl },
      context,
    ),
    text: plainText(
      {
        title: 'Notes archived',
        lines: [sentence, 'Archived notes are kept: open the notes page to restore any of them.'],
        ctaLabel: data.notesUrl ? 'Open notes' : undefined,
        ctaUrl: data.notesUrl,
      },
      context,
    ),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}
