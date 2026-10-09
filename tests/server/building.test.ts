import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building, type FloorDef } from '../../src/server/floor/building.js';
import { stateDoc } from '../../src/server/db/state.js';
import { prepareHome } from '../../src/server/floor/home.js';
import { HOME_FLOOR } from '../../src/shared/building/floors.js';

function office(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-building-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, '.agent-office');
  mkdirSync(dataDir);
  const floor = (id: string, palette: number): FloorDef => {
    const dir = path.join(root, 'acme', id);
    mkdirSync(dir, { recursive: true });
    return { id, name: id, repo: `acme/${id}`, dir, palette, addedBy: 'Sam', addedAt: 1 };
  };
  const defs = [floor('api', 0), floor('web', 1), floor('docs', 2)];
  stateDoc<any>(dataDir, 'floors').write(defs);
  return { root, dataDir, defs };
}

const saved = (dataDir: string) => (stateDoc<any>(dataDir, 'floors').read() as FloorDef[]).map((d) => d.id);

test("the office's own floor is always first, a git folder with no repository, and never comes off", (t) => {
  const { root, dataDir } = office(t);
  const building = new Building(dataDir, root);
  const dir = prepareHome(path.join(dataDir, 'office'));
  assert.equal(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(), 'main');

  const home = building.ensureHome(dir);
  assert.equal(home.repo, undefined);
  assert.deepEqual(building.list().map((d) => d.id), [HOME_FLOOR, 'api', 'web', 'docs']);
  assert.equal(typeof building.remove(HOME_FLOOR), 'string');

  // A restart finds it again rather than adding a second one, and preparing it twice is harmless.
  const again = new Building(dataDir, root);
  again.ensureHome(prepareHome(dir));
  assert.deepEqual(again.list().map((d) => d.id), [HOME_FLOOR, 'api', 'web', 'docs']);
});

test('a floor comes off the building and stays off, with its checkout left where it was', (t) => {
  const { root, dataDir, defs } = office(t);
  const building = new Building(dataDir, root);

  const r = building.remove('web');
  assert.equal(typeof r, 'object');
  assert.equal((r as FloorDef).dir, defs[1].dir);
  assert.deepEqual(building.list().map((d) => d.id), ['api', 'docs']);
  assert.deepEqual(saved(dataDir), ['api', 'docs']);
  assert.ok(existsSync(defs[1].dir), 'the checkout stays on disk');

  // After a restart it's still gone.
  assert.deepEqual(new Building(dataDir, root).list().map((d) => d.id), ['api', 'docs']);
});

test("floors that aren't there can't be taken off", (t) => {
  const { root, dataDir } = office(t);
  const building = new Building(dataDir, root);

  assert.equal(building.remove('nope'), 'No such floor');
  assert.deepEqual(saved(dataDir), ['api', 'web', 'docs']);
});

test('the floor the office was started in comes off too, stays off after a restart, and moves back in when its repository is added again', async (t) => {
  const { root, dataDir, defs } = office(t);
  // The office's own checkout, with its GitHub origin (how it's recognised once it's no longer a floor).
  execFileSync('git', ['init', '-q', defs[0].dir]);
  execFileSync('git', ['-C', defs[0].dir, 'remote', 'add', 'origin', 'https://github.com/acme/api.git']);
  const building = new Building(dataDir, root);
  building.ensureLocal(defs[0].dir, 'the office');
  assert.ok(building.isLocal('api'));
  assert.ok(!building.isLocal('web'));

  const r = building.remove('api', 'Sam');
  assert.equal((r as FloorDef).id, 'api');
  assert.ok(!building.isLocal('api'));
  assert.deepEqual(saved(dataDir), ['web', 'docs']);
  assert.ok(existsSync(defs[0].dir), 'the checkout stays on disk');

  // The next start doesn't put it back.
  const again = new Building(dataDir, root);
  assert.equal(again.ensureLocal(defs[0].dir, 'the office'), undefined);
  assert.deepEqual(again.list().map((d) => d.id), ['web', 'docs']);
  assert.deepEqual(saved(dataDir), ['web', 'docs']);

  // Adding acme/api again uses the checkout it always was (no clone, no GitHub needed).
  const started: string[] = [];
  const back = await again.add('https://github.com/acme/api', 'Sam', (d) => started.push(d.dir));
  assert.equal(typeof back, 'object', String(back));
  assert.equal((back as FloorDef).dir, defs[0].dir);
  assert.deepEqual(started, [defs[0].dir]);
  assert.ok(again.isLocal((back as FloorDef).id));
  assert.deepEqual(saved(dataDir), ['web', 'docs', 'api']);
  assert.equal(stateDoc<any>(dataDir, 'local-floor').read(), undefined);

  // ...and it's a floor again at the next start.
  const third = new Building(dataDir, root);
  assert.equal(third.ensureLocal(defs[0].dir, 'the office')?.id, 'api');
  assert.deepEqual(third.list().map((d) => d.id), ['web', 'docs', 'api']);
});

test("someone's own floor: only they and admins see it until they share it, and only they or an admin may", async (t) => {
  const { dataDir, root, defs } = office(t);
  const { seesFloor } = await import('../../src/shared/building/floors.js');
  stateDoc<any>(dataDir, 'floors').write([{ ...defs[0], owner: 'sam' }, defs[1]]);
  const building = new Building(dataDir, root);
  const [api, web] = building.list();
  assert.equal(api.owner, 'sam', 'the owner is kept');
  assert.ok(seesFloor(api, 'sam', false));
  assert.ok(!seesFloor(api, 'ann', false), "not Ann's to see");
  assert.ok(seesFloor(api, 'ann', true), 'admins see every floor');
  assert.ok(seesFloor(web, 'ann', false), "one with no owner is everyone's");
  // Ann can't share it, and adding its repository again tells her whose it is.
  assert.match(String(building.share('api', true, 'ann', false)), /Only whoever added a floor/);
  assert.match(String(await building.add('acme/api', 'Ann', () => {}, 'ann')), /already a floor, Sam's own: ask them to share it/);
  assert.match(String(building.share('web', true, 'sam', false)), /everyone's already/);
  // Sam shares it: everyone sees it, and it's saved that way.
  assert.equal(typeof building.share('api', true, 'sam', false), 'object');
  assert.ok(seesFloor(new Building(dataDir, root).list()[0], 'ann', false));
  assert.match(String(await building.add('acme/api', 'Ann', () => {}, 'ann')), /already has a floor$/);
  // And keeps it to himself again (an admin could too).
  assert.equal(typeof building.share('api', false, 'boss', true), 'object');
  assert.ok(!seesFloor(new Building(dataDir, root).list()[0], 'ann', false));
});
