/**
 * The dashboard (admin.php) must carry the same version number as the game, so everything stays aligned.
 *
 *   npm run check-versions
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const game = /VERSION\s*=\s*'([^']+)'/.exec(readFileSync(join(root, 'modern-tim/src/game/version.ts'), 'utf8'))?.[1];
const admin = /const ADMIN_BUILD = '([^']+)'/.exec(readFileSync(join(root, 'admin.php'), 'utf8'))?.[1];
const readme = /Version ([0-9][0-9a-z.]*):/.exec(readFileSync(join(root, 'README.md'), 'utf8'))?.[1];
const changelog = /## Modern TIM ([0-9][0-9a-z.]*)/.exec(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'))?.[1];
assert.ok(game && admin, 'could not find a version number');
assert.equal(admin, game, `admin.php ADMIN_BUILD (${admin}) must equal the game VERSION (${game})`);
assert.equal(readme, game, `README.md says version ${readme}, the game is ${game}`);
assert.equal(changelog, game, `the top CHANGELOG entry is ${changelog}, the game is ${game}`);
console.log(`OK game, dashboard, README and CHANGELOG are all version ${game}`);
