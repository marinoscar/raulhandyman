// The content API serves the retouched crops when a photo's chosen variant is
// the AI retouch, and falls back to the standard crops when one is missing.
import { SiteMediaService } from '../../src/site/site-media.service';

const obj = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const photo = (chosenVariant: string, extra: Record<string, unknown> = {}) => ({
  id: obj(1),
  width: 64,
  height: 48,
  chosenVariant,
  originalObjectId: obj(10),
  enhancedObjectId: obj(11),
  retouchedObjectId: obj(12),
  renditions: {
    card4x3: { objectId: obj(20), w: 40, h: 30 },
    hero16x9: { objectId: obj(21), w: 48, h: 27 },
    og: { objectId: obj(22), w: 1200, h: 630 },
    ogBranded: { objectId: obj(23), w: 1200, h: 630 },
    retouchedCard4x3: { objectId: obj(30), w: 41, h: 31 },
    retouchedHero16x9: { objectId: obj(31), w: 49, h: 28 },
    retouchedThumb: { objectId: obj(32), w: 10, h: 10 },
    retouchedOg: { objectId: obj(33), w: 1200, h: 630 },
    ...extra,
  },
});

const service = new SiteMediaService({} as never, {} as never);

describe('SiteMediaService.source with the retouched variant', () => {
  it('serves the retouched crops and the retouched master', () => {
    const p = photo('retouched');
    expect(service.source(p, 'card4x3')).toMatchObject({ objectId: obj(30), width: 41, height: 31 });
    expect(service.source(p, 'hero16x9')).toMatchObject({ objectId: obj(31), width: 49, height: 28 });
    expect(service.source(p, 'master')?.objectId).toBe(obj(12));
  });

  it('falls back to the standard crop when a retouched one is missing', () => {
    const p = photo('retouched', { retouchedCard4x3: undefined });
    expect(service.source(p, 'card4x3')?.objectId).toBe(obj(20));
    expect(service.source(p, 'hero16x9')?.objectId).toBe(obj(31));
  });

  it('keeps the standard crops for the enhanced and original variants', () => {
    for (const variant of ['enhanced', 'original']) {
      const p = photo(variant);
      expect(service.source(p, 'card4x3')?.objectId).toBe(obj(20));
      expect(service.source(p, 'hero16x9')?.objectId).toBe(obj(21));
    }
  });

  it('keeps the branded OG (built from the standard og crop) for the retouched variant', () => {
    expect(service.source(photo('retouched'), 'og-branded')?.objectId).toBe(obj(23));
  });
});
