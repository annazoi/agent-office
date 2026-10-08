// An office that used the earlier optional database mode kept two rows, `accounts` and `composio`, by
// themselves. An office with no documents of its own yet still reads them, so its Composio key and
// its accounts carry over, and what it saves from then on goes under its own folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../../src/server/accounts/accounts.js';
import { ComposioHub } from '../../src/server/integrations/composio.js';
import { freshDb } from '../support/db.js';
import { stateDoc } from '../../src/server/db/state.js';

const KEY = 'ak_test_0123456789abcdef';

test('the accounts and Composio key rows of the earlier optional database mode carry over', async () => {
  const salt = '00'.repeat(16);
  await freshDb(
    new Map([
      ['accounts', JSON.stringify({ accounts: [{ id: 'a1', name: 'Ada', role: 'admin', hash: 'ff', salt, createdAt: 1, createdBy: 'x' }], invites: [] })],
      ['composio', JSON.stringify({ apiKey: KEY, toolkits: ['linear', 'slack'], by: 'Sam', at: 1 })],
    ]),
  );
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-legacy-rows-'));
  const accounts = new Accounts(dir);
  assert.equal(accounts.byName('Ada')?.id, 'a1');
  const hub = new ComposioHub(dir, () => {}, () => {});
  assert.equal(hub.configured, true);
  assert.deepEqual([...hub.toolkits], ['linear', 'slack']);
  // What's saved from here on is the office's own document, and the old row is left alone.
  await hub.setToolkits(['gmail']);
  assert.deepEqual(stateDoc<{ toolkits?: string[] }>(dir, 'composio').read()?.toolkits, ['gmail']);
});
