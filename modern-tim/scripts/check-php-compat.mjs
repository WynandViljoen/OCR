/**
 * Guards the server files against syntax that old hosts (PHP 7.0 to 7.3) cannot parse.
 *   npm run check-php-compat
 * Our cPanel host once failed on `fn() =>` (PHP 7.4+), so scores.php, admin.php and share.php
 * must stay plain: no arrow functions, no `mixed`/nullable/void types, no ??=, no spread,
 * no match, no str_contains and friends, no options-array cookies without a version guard.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rules = [
  [/(?<![$\w])fn\s*\(/, 'arrow function fn() (PHP 7.4)'],
  [/\bmatch\s*\(/, 'match (PHP 8.0)'],
  [/\bmixed\b\s+\$/, 'mixed type (PHP 8.0)'],
  [/\)\s*:\s*\?[a-z]/i, 'nullable return type (PHP 7.1)'],
  [/\)\s*:\s*void\b/, 'void return type (PHP 7.1)'],
  [/\(\s*\?[a-z]+\s+\$|,\s*\?[a-z]+\s+\$/i, 'nullable parameter type (PHP 7.1)'],
  [/\?\?=/, '??= (PHP 7.4)'],
  [/\?->/, 'nullsafe ?-> (PHP 8.0)'],
  [/\.\.\.\s*[$\[]/, 'spread operator (PHP 7.4 in arrays)'],
  [/\bstr_(contains|starts_with|ends_with)\b/, 'str_contains family (PHP 8.0)'],
  [/\barray_(key_first|key_last|is_list)\b/, 'array_key_first/last, array_is_list (PHP 7.3/8.1)'],
  [/catch\s*\(\s*[\\\w|]+\s*\)/, 'catch without a variable (PHP 8.0)'],
  [/\[\s*\$\w+\s*,\s*\$\w+\s*\]\s*=[^=>]/, 'array destructuring assignment (PHP 7.1)'],
];
let bad = 0;
for (const f of ['scores.php', 'admin.php', 'share.php']) {
  const lines = readFileSync(join(root, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\*|\/\/|#|\/\*)/.test(line)) return; // comments
    for (const [re, what] of rules) {
      if (re.test(line)) {
        console.log(`BAD ${f}:${i + 1} ${what}\n    ${line.trim()}`);
        bad++;
      }
    }
  });
  const src = lines.join('\n');
  if (/setcookie\(|session_set_cookie_params\(/.test(src)) assert.ok(/PHP_VERSION_ID\s*>=\s*70300/.test(src), `${f}: cookies with an options array need a PHP_VERSION_ID >= 70300 guard`);
  console.log(`OK ${f}`);
}
assert.equal(bad, 0, `${bad} old-PHP problem(s)`);
