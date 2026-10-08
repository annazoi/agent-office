// An office from before the database: its JSON files are brought over into it, once, and it carries
// on with its accounts, floors, chat and each floor's state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { officeRanIn } from '../../src/server/config.js';
import { Accounts } from '../../src/server/accounts/accounts.js';
import { ChatLog, ScrollbackStore } from '../../src/server/floor/history.js';
import { Maps } from '../../src/server/floor/maps.js';
import { stateDoc } from '../../src/server/db/state.js';
import { userDoc } from '../../src/server/accounts/user-config.js';

const json = (file: string, value: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

test('an office of JSON files is brought over into the database once, and carries on from there', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'ao-migrate-'));
  const office = path.join(tmp, 'home');
  const data = path.join(office, '.agent-office');
  const floorDir = path.join(tmp, 'acme');
  const floorData = path.join(floorDir, '.agent-office');

  // A real account's hash, as accounts.json kept it.
  const scratch = new Accounts(path.join(tmp, 'scratch'));
  const ada = await scratch.register('Ada', 'ada-password');
  assert.ok(typeof ada === 'object');
  json(path.join(data, 'config.json'), { secret: 'abc', salt: '00', verifier: 'ff', claimedAt: 1 });
  json(path.join(data, 'accounts.json'), { accounts: [ada], invites: [], sharedPassword: true });
  json(path.join(data, 'floors.json'), [{ id: 'acme', name: 'acme', dir: floorDir, palette: 0, addedBy: 'Ada', addedAt: 1 }]);
  json(path.join(data, 'chat.jsonl'), `${JSON.stringify({ from: 'x', name: 'Ada', color: '#fff', text: 'hello', at: 1 })}\n{"torn`);
  json(path.join(data, 'homes', ada.id, 'signins.json'), { claude: 'office' });
  json(path.join(data, 'maps', 'my-hall.json'), { id: 'hall', name: 'My hall', extends: 'castle' });
  json(path.join(data, 'hook-port'), '4601');
  json(path.join(floorData, 'queue.json'), { maxWorkers: 2, tasks: [] });
  json(path.join(floorData, 'scrollback', 'w1.ansi'), 'old lines');
  // Something the database already has is never written over.
  stateDoc(floorData, 'decor').write([{ id: 'kept' }]);
  json(path.join(floorData, 'decor.json'), [{ id: 'from-file' }]);

  assert.equal(officeRanIn(office), true, 'found, and brought over');
  assert.deepEqual(stateDoc<{ secret?: string }>(data, 'config').read()?.secret, 'abc');
  const accounts = new Accounts(data);
  assert.equal((await accounts.check('Ada', 'ada-password'))?.id, ada.id, 'the same password still signs Ada in');
  assert.deepEqual(new ChatLog(data).recent(5).map((l) => l.text), ['hello']);
  assert.deepEqual(userDoc(data, ada.id, 'signins').read(), { claude: 'office' });
  assert.equal(new Maps(data).state().custom[0]?.config?.name, 'My hall');
  assert.equal(stateDoc(data, 'hook-port').read(), 4601);
  assert.deepEqual(stateDoc(floorData, 'queue').read(), { maxWorkers: 2, tasks: [] });
  assert.equal(new ScrollbackStore(floorData).load('w1'), 'old lines');
  assert.deepEqual(stateDoc(floorData, 'decor').read(), [{ id: 'kept' }]);
  // The files are left as they were, and it isn't brought over twice.
  assert.ok(existsSync(path.join(data, 'config.json')));
  stateDoc(data, 'chat').write([]);
  assert.equal(officeRanIn(office), true);
  assert.deepEqual(stateDoc(data, 'chat').read(), []);
  // A folder with no office in it is none.
  assert.equal(officeRanIn(path.join(tmp, 'nothing')), false);
});
