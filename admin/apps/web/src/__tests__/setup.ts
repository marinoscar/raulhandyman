import '@testing-library/jest-dom/vitest';

// jsdom has no canvas: the SEO preview then falls back to an average-glyph width estimate.
HTMLCanvasElement.prototype.getContext = () => null;
