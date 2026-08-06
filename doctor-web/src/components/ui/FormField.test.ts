import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TextField } from './FormField';

describe('FormField / TextField', () => {
  it('wires aria-invalid and aria-describedby to the error message when in error', () => {
    const markup = renderToStaticMarkup(
      createElement(TextField, {
        label: '휴대폰 번호',
        error: '휴대폰 번호 11자리를 입력해 주세요',
      }),
    );

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('휴대폰 번호 11자리를 입력해 주세요');

    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    const errorId = markup.match(/<p id="([^"]+)"[^>]*role="alert"/)?.[1];

    expect(describedBy).toBeTruthy();
    expect(errorId).toBeTruthy();
    expect(describedBy?.split(' ')).toContain(errorId);
  });

  it('does not mark the field invalid when there is no error', () => {
    const markup = renderToStaticMarkup(
      createElement(TextField, { label: '이름', hint: '실명을 입력해 주세요' }),
    );

    expect(markup).not.toContain('aria-invalid');
    expect(markup).not.toContain('role="alert"');
    expect(markup).toContain('실명을 입력해 주세요');
  });
});
