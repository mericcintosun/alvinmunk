import { describe, it, expect } from 'vitest';
import { loadPngDataUri } from './og-assets';
import { faceFile } from './avatar';

describe('loadPngDataUri', () => {
  it('inlines a real asset PNG as a base64 data-URI', () => {
    const uri = loadPngDataUri(faceFile('face-01'));
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    expect(uri.length).toBeGreaterThan(100);
  });

  it('memoizes — same path returns the identical string reference', () => {
    expect(loadPngDataUri('stickers/face-02.png')).toBe(loadPngDataUri('stickers/face-02.png'));
  });
});
