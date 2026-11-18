import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(m, `Missing ${selector}`);
  return m[1];
};
test('editor text is never transparent in light or dark mode', () => {
  const light = rule('.editor textarea');
  const dark = rule('[data-theme="dark"] .editor textarea');
  for (const r of [light, dark]) {
    assert.match(r, /(?:^|;)color:\s*#[0-9a-f]{3,8}/i);
    assert.match(r, /-webkit-text-fill-color:\s*#[0-9a-f]{3,8}/i);
    assert.doesNotMatch(r, /(?:^|;)color:\s*transparent/i);
    assert.doesNotMatch(r, /-webkit-text-fill-color:\s*transparent/i);
  }
  assert.ok(html.includes(light), 'Generated HTML should contain latest editor styles');
  assert.ok(html.includes(dark), 'Generated HTML should contain latest dark styles');
});
