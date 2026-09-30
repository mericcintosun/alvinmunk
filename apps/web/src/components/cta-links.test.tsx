import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenAppLink, SuggestionViewLink, VouchActionLink } from './cta-links';

function renderCtas(): Document {
  const markup = renderToStaticMarkup(
    <>
      <OpenAppLink>Open your app</OpenAppLink>
      <VouchActionLink>Vouch</VouchActionLink>
      <SuggestionViewLink href="/u/alice" ariaLabel="View @alice">
        View
      </SuggestionViewLink>
    </>,
  );
  return new DOMParser().parseFromString(markup, 'text/html');
}

describe('CTA links', () => {
  it('renders each CTA as one link without a nested button', () => {
    const document = renderCtas();

    expect(document.querySelectorAll('a')).toHaveLength(3);
    expect(document.querySelector('a button')).toBeNull();
    expect([...document.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/app',
      '/app/vouch',
      '/u/alice',
    ]);
  });
});