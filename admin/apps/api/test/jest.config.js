/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  // 'ts' before 'json': `./catalog` must resolve to catalog.ts, not the vendored catalog.json beside it.
  moduleFileExtensions: ['ts', 'js', 'json'],
  testRegex: '.*\\.spec\\.ts$',
  // isolatedModules: transpile each file on its own (fast); `npm run typecheck` type-checks src/ and test/.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { isolatedModules: true } }] },
  testEnvironment: 'node',
  roots: ['<rootDir>/src/', '<rootDir>/test/'],
  testTimeout: 30000,
};
