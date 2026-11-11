// Build-time Markdown for project bodies. Raw HTML is escaped, images are dropped,
// unsafe link schemes are removed, and headings never go above h2 (the page owns the h1).
import { Marked } from 'marked';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => esc(text),
    image: () => '',
    heading({ tokens, depth }) {
      const level = Math.min(Math.max(depth, 2), 4);
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
    },
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      return /^(https?:|mailto:|tel:|\/|#)/i.test(href) ? `<a href="${esc(href)}" rel="noopener">${inner}</a>` : inner;
    },
  },
});

export function renderMarkdown(src: string): string {
  return md.parse(src, { async: false });
}
