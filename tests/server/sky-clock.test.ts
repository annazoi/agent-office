import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Sky } from '../../src/server/floor/sky.js';
import { stateDoc } from '../../src/server/db/state.js';

test('the sky keeps the clock someone picked, and keeps it across a restart', () => {
  const clockDoc = stateDoc<unknown>(mkdtempSync(path.join(tmpdir(), 'sky-clock-')), 'sky-clock');
  const heard: boolean[] = [];
  const sky = new Sky({ weather: 'clear', realTime: false, clockDoc }, (s) => heard.push(!!s.realTime));
  assert.equal(sky.state.realTime, undefined);
  sky.setClock(true);
  assert.equal(sky.state.realTime, true);
  assert.deepEqual(heard, [true]);
  // After a restart the pick wins over the command line.
  assert.equal(new Sky({ weather: 'clear', realTime: false, clockDoc }, () => {}).state.realTime, true);
  sky.setClock(false);
  assert.equal(sky.state.realTime, undefined);
  assert.equal(new Sky({ weather: 'clear', realTime: true, clockDoc }, () => {}).state.realTime, undefined);
});
