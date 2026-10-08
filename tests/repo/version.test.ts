// The office reads no JSON file, its own package.json included, so its version is a constant
// (src/server/version.ts) that has to be kept equal to package.json's. This is what keeps it so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '../../src/server/version.js';

test("src/server/version.ts is package.json's version (bump both when the version changes)", () => {
  const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
  assert.equal(APP_VERSION, pkg.version);
});
