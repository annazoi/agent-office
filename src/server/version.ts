/**
 * The release this code is, for an install that isn't a git checkout (a checkout is told by its
 * commit). Kept equal to package.json's version by tests/repo/version.test.ts: the office reads no
 * JSON file, its own package.json included.
 */
export const APP_VERSION = '0.1.0';
