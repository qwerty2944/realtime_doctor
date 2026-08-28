import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import Button from './Button';

describe('Button', () => {
  it('disables the button and marks it busy while loading (prevents double submit)', () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { loading: true }, '제출'),
    );

    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-busy="true"');
  });

  it('is enabled and not busy by default', () => {
    const markup = renderToStaticMarkup(createElement(Button, {}, '다음'));

    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain('aria-busy');
    expect(markup).toContain('다음');
  });

  it('throws when iconOnly is used without an aria-label', () => {
    expect(() =>
      renderToStaticMarkup(createElement(Button, { iconOnly: true })),
    ).toThrow(/aria-label/);
  });

  it('renders an icon-only button when an aria-label is provided', () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { iconOnly: true, 'aria-label': '닫기' }),
    );

    expect(markup).toContain('aria-label="닫기"');
  });
});
