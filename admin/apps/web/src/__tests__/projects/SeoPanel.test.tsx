import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lintProject } from '@app/shared/seo-lint';

import { SeoPanel } from '../../projects/SeoPanel';
import { truncateToWidth } from '../../projects/textUtils';
import { fixtureLint } from './lintFixture';

/** A deterministic ruler: every character is 10px wide at any font. */
const tenPx = (text: string) => text.length * 10;

const props = { slug: 'wall-repair', title: 'Wall repair', seoTitle: '', metaDescription: '', lint: { errors: [], warnings: [], score: 100 }, measure: tenPx };

describe('SeoPanel', () => {
  it('truncates a long SEO title at about 580px and a long description at about 920px', () => {
    const longTitle = 'A'.repeat(100); // 1000px
    const longDescription = 'b'.repeat(150); // 1500px
    render(<SeoPanel {...props} seoTitle={longTitle} metaDescription={longDescription} />);

    const title = screen.getByTestId('google-title').textContent!;
    expect(title.endsWith('…')).toBe(true);
    expect(tenPx(title)).toBeLessThanOrEqual(580);
    expect(tenPx(title)).toBeGreaterThan(560);
    const description = screen.getByTestId('google-description').textContent!;
    expect(description.endsWith('…')).toBe(true);
    expect(tenPx(description)).toBeLessThanOrEqual(920);
  });

  it('leaves a short title alone and falls back from SEO title to title', () => {
    render(<SeoPanel {...props} />);
    expect(screen.getByTestId('google-title')).toHaveTextContent(/^Wall repair$/);
    expect(screen.getByText(/raulhandyman\.net › projects › wall-repair/)).toBeInTheDocument();
  });

  it('switches between desktop and mobile previews', async () => {
    render(<SeoPanel {...props} />);
    expect(screen.getByTestId('google-preview')).toHaveAttribute('data-device', 'desktop');
    await userEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByTestId('google-preview')).toHaveAttribute('data-device', 'mobile');
  });

  it('shows the social preview with the branded image', () => {
    render(<SeoPanel {...props} ogImageUrl="https://img.example.test/og.jpg" />);
    expect(screen.getByRole('img', { name: 'Social sharing image' })).toHaveAttribute('src', 'https://img.example.test/og.jpg');
  });

  it('lists errors and warnings with the score', () => {
    render(<SeoPanel {...props} lint={fixtureLint()} />);
    expect(screen.getByRole('img', { name: /SEO score \d+ out of 100/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Go to field/ }).length).toBe(fixtureLint().errors.length + fixtureLint().warnings.length);
  });

  it('"Go to field" scrolls to and focuses the field', async () => {
    render(
      <>
        <input id="field-seoTitle" aria-label="SEO title" />
        <input id="field-metaDescription" aria-label="Meta description" />
        <input id="photo-alt-p1" aria-label="Alt text" />
        <SeoPanel
          {...props}
          lint={{
            errors: [
              { code: 'seo_title.length', field: 'seoTitle', message: 'SEO title must be 30-60 characters (now 0).' },
              { code: 'photo.alt_missing', field: 'altText', message: 'Alt text needs at least 15 characters.', photoId: 'p1' },
            ],
            warnings: [],
            score: 76,
          }}
        />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Go to field: SEO title must be 30-60 characters (now 0).' }));
    expect(screen.getByLabelText('SEO title')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Go to field: Alt text needs at least 15 characters.' }));
    expect(screen.getByLabelText('Alt text')).toHaveFocus();
  });
});

describe('truncateToWidth', () => {
  it('returns text that fits unchanged', () => {
    expect(truncateToWidth('short', 100, '20px Arial', tenPx)).toEqual({ text: 'short', truncated: false });
  });
  it('cuts to the largest prefix that fits with the ellipsis', () => {
    expect(truncateToWidth('abcdefghijklmnop', 100, '20px Arial', tenPx)).toEqual({ text: 'abcdefghi…', truncated: true });
  });
});

describe('the lint is the shared one', () => {
  it('gives the same result for the same fixture as the API (one function, one fixture)', async () => {
    const apiModule = await import('../../../../api/src/projects/seo-lint');
    expect(apiModule.lintProject).toBe(lintProject);
    expect(fixtureLint()).toEqual(apiModule.lintProject(...fixtureArgs()));
  });
});

import { fixtureArgs } from './lintFixture';
