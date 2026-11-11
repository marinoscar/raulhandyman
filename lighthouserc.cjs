// Lighthouse CI config (issue #38). A .cjs so the project URL can be read at
// config time from the fixture manifest when it exists.
const fs = require('node:fs');

function firstProjectSlug() {
  try {
    const m = JSON.parse(fs.readFileSync('fixtures/content/manifest.json', 'utf8'));
    const list = Array.isArray(m) ? m : m.projects ?? m.items ?? [];
    const first = list[0];
    return typeof first === 'string' ? first : first?.slug ?? null;
  } catch {
    return null;
  }
}

const slug = firstProjectSlug();
const urls = ['/', '/drywall-repair/', '/projects/', ...(slug ? [`/projects/${slug}/`] : [])];

module.exports = {
  ci: {
    collect: {
      staticDistDir: 'dist',
      url: urls,
      numberOfRuns: 3,
      // Lighthouse default is mobile emulation (preset 'mobile' is not valid)
      settings: { chromeFlags: '--no-sandbox' },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.98 }],
        'categories:seo': ['error', { minScore: 0.98 }],
        'categories:accessibility': ['error', { minScore: 0.98 }],
        'categories:best-practices': ['error', { minScore: 0.98 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 1800 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.02 }],
        'total-blocking-time': ['warn', { maxNumericValue: 50 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
