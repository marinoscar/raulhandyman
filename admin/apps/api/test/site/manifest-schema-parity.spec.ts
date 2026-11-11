// The frozen JSON Schema (source of truth, repository root) and the Zod mirror
// must agree: the fixture manifest passes both, and each negative case fails both.
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { siteManifestSchema } from '../../src/site/site-manifest.schema';

const ROOT = resolve(__dirname, '../../../../..');
const jsonSchema = JSON.parse(readFileSync(resolve(ROOT, 'src/content/manifest.schema.json'), 'utf8'));
const fixture = (): any => JSON.parse(readFileSync(resolve(ROOT, 'fixtures/content/manifest.json'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv as never);
const validate = ajv.compile(jsonSchema);

const both = (value: unknown) => ({ json: validate(value) as boolean, zod: siteManifestSchema.safeParse(value).success });

describe('site manifest: JSON Schema and Zod parity', () => {
  it('both accept the fixture manifest', () => {
    expect(both(fixture())).toEqual({ json: true, zod: true });
  });

  const cases: Array<[string, (m: any) => void]> = [
    ['missing altText', (m) => delete m.projects[0].photos[0].altText],
    ['empty altText', (m) => (m.projects[0].photos[0].altText = '')],
    ['extra workNotes on a project', (m) => (m.projects[0].workNotes = 'private')],
    ['extra aiSuggestion on a photo', (m) => (m.projects[0].photos[0].aiSuggestion = {})],
    ['extra storageKey on a rendition', (m) => (m.projects[0].photos[0].renditions.master.storageKey = 'k')],
    ['bad project slug', (m) => (m.projects[0].slug = 'Bad Slug!')],
    ['bad redirect shape', (m) => (m.redirects[0].from = '/old/')],
    ['wrong manifestVersion', (m) => (m.manifestVersion = 2)],
    ['bad sha256', (m) => (m.projects[0].photos[0].renditions.master.sha256 = 'abc')],
    ['missing hero rendition', (m) => delete m.projects[0].photos[0].renditions.hero16x9],
    ['project without photos', (m) => (m.projects[0].photos = [])],
    ['bad role', (m) => (m.projects[0].photos[0].role = 'during')],
    ['bad indexNowKey', (m) => (m.indexNowKey = 'short')],
    ['bad completedOn', (m) => (m.projects[0].completedOn = 'yesterday')],
    ['bad generatedAt', (m) => (m.generatedAt = 'not a date')],
    ['focal out of range', (m) => (m.projects[0].photos[0].focal = { x: 2, y: 0.5 })],
  ];
  it.each(cases)('both reject: %s', (_name, mutate) => {
    const manifest = fixture();
    mutate(manifest);
    expect(both(manifest)).toEqual({ json: false, zod: false });
  });

  it('both accept the optional indexNowKey set and absent', () => {
    const withKey = fixture();
    withKey.indexNowKey = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(both(withKey)).toEqual({ json: true, zod: true });
    const without = fixture();
    delete without.indexNowKey;
    expect(both(without)).toEqual({ json: true, zod: true });
  });
});
