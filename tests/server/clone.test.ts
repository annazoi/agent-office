import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building, type FloorDef } from '../../src/server/floor/building.js';
import { githubAuthEnv, parseProgress, whyCloneFailed } from '../../src/server/integrations/clone.js';
import type { RepoSource } from '../../src/server/integrations/github-composio.js';
import { stateDoc } from '../../src/server/db/state.js';

// A stand-in for `git clone` of github.com/<name>, from the bare repositories in $FAKE_GH_REPOS. It
// says how far along it is the way git does, can wait first ($FAKE_GH_DELAY), hang ($FAKE_GH_HANG)
// or fail the way git does without a way in ($FAKE_GH_FAIL), and writes what token it was given
// ($FAKE_GH_TOKEN_LOG) the way git would see it, in its environment.
const FAKE_CLONE = `#!/bin/sh
name="$1"; dest="$2"
printf "Cloning into '%s'...\\n" "$dest" >&2
[ -n "$FAKE_GH_TOKEN_LOG" ] && printf '%s' "$GIT_CONFIG_VALUE_0" > "$FAKE_GH_TOKEN_LOG"
[ -n "$FAKE_GH_FAIL" ] && { echo "$FAKE_GH_FAIL" >&2; echo "fatal: Could not read from remote repository." >&2; exit 128; }
[ -n "$FAKE_GH_HANG" ] && exec sleep 600
printf "Receiving objects:  42%% (42/100), 1.00 MiB | 512.00 KiB/s\\r" >&2
[ -n "$FAKE_GH_DELAY" ] && sleep "$FAKE_GH_DELAY"
git clone -q "$FAKE_GH_REPOS/$name.git" "$dest" || exit 1
git -C "$dest" remote set-url origin "https://github.com/$name.git"
`;

/** Everyone's GitHub, as Composio would answer for an account named in $FAKE_GH_REPOS (its bare repositories). */
const github: RepoSource = {
  blocked: async (account) => (account === 'sam-account' || account === 'ann-account' ? undefined : 'Connect your GitHub first (☰ → ⚙️ Settings → Connections)'),
  list: async () => [],
  view: async (_account, repo) => {
    if (!existsSync(path.join(process.env.FAKE_GH_REPOS!, `${repo}.git`))) throw new Error('Not Found');
    return { repo, empty: false };
  },
  token: async (account) => (account === 'sam-account' ? 'gho_samstoken0123456789abcdef' : undefined),
};

const fast = { clone: { tickMs: 50, stallMs: 1500 } };
/** A building whose clones run the stand-in, and whose GitHub is the one above. */
function makeBuilding(dataDir: string, projects: string, opts: { clone?: { tickMs?: number; stallMs?: number } } = fast) {
  const b = new Building(dataDir, projects, { clone: { ...opts.clone, command: (repo, dest) => ['sh', [process.env.FAKE_CLONE!, repo, dest]] } });
  b.repoSource = github;
  return b;
}

function office(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-clone-'));
  const pids: number[] = [];
  t.after(() => {
    for (const pid of pids) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    rmSync(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, '.agent-office');
  mkdirSync(dataDir);
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'fake-clone'), FAKE_CLONE);
  chmodSync(path.join(bin, 'fake-clone'), 0o755);
  process.env.FAKE_CLONE = path.join(bin, 'fake-clone');
  const repos = path.join(root, 'github');
  // acme/game on "GitHub", with a commit.
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '-q', work]);
  writeFileSync(path.join(work, 'index.html'), '<h1>game</h1>');
  execFileSync('git', ['-C', work, 'add', '.']);
  execFileSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first']);
  execFileSync('git', ['clone', '-q', '--bare', work, path.join(repos, 'acme', 'game.git')]);
  process.env.FAKE_GH_REPOS = repos;
  for (const k of ['FAKE_GH_DELAY', 'FAKE_GH_HANG', 'FAKE_GH_FAIL', 'FAKE_GH_TOKEN_LOG']) delete process.env[k];
  const projects = path.join(root, 'projects');
  /** The clones under way, as the office keeps them for the next one. */
  const saved = () => (stateDoc<any>(dataDir, 'cloning').read() ?? []) as (FloorDef & { pid: number })[];
  const running = async () => {
    for (let i = 0; i < 200 && !saved().length; i++) await new Promise((r) => setTimeout(r, 25));
    const pid = saved()[0]?.pid;
    assert.ok(pid, 'the clone is in the cloning document');
    pids.push(pid);
    return pid;
  };
  return { root, dataDir, projects, saved, running };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 25));
};

test("git's progress reads as a step, how far and how fast", () => {
  const out = "Cloning into '/x/acme/game'...\nremote: Enumerating objects: 2742, done.\nremote: Counting objects: 100% (5/5), done.\nReceiving objects:  12% (330/2742), 40.12 MiB | 1.52 MiB/s\rReceiving objects:  64% (1755/2742), 231.40 MiB | 1.50 MiB/s\r";
  assert.deepEqual(parseProgress(out), { step: 'Downloading', percent: 64, detail: '231.40 MiB · 1.50 MiB/s' });
  assert.deepEqual(parseProgress(`${out}Receiving objects: 100% (2742/2742), 362.00 MiB | 1.50 MiB/s, done.\nResolving deltas:  30% (3/10)\r`), { step: 'Unpacking', percent: 30 });
  assert.deepEqual(parseProgress('remote: Compressing objects:  50% (1/2)\r'), { step: 'GitHub is packing it up', percent: 50 });
  assert.deepEqual(parseProgress('Updating files:  99% (990/1000)\r'), { step: 'Checking out files', percent: 99 });
  assert.deepEqual(parseProgress("Cloning into '/x'...\n"), { step: 'Connecting to GitHub' });
  assert.equal(parseProgress(''), undefined);
});

test('a failed clone says what to do about it', () => {
  assert.match(whyCloneFailed("remote: Repository not found.\nfatal: Authentication failed for 'https://github.com/acme/x.git/'\n"), /your own GitHub connected/);
  assert.match(whyCloneFailed("fatal: could not read Username for 'https://github.com': terminal prompts disabled\n"), /Connections/);
  assert.equal(whyCloneFailed('Receiving objects:  1% (1/100)\rerror: RPC failed\nfatal: early EOF\n'), 'error: RPC failed fatal: early EOF');
});

test('a clone shows how far along it is, then becomes a floor', async (t) => {
  const { dataDir, projects, saved } = office(t);
  process.env.FAKE_GH_DELAY = '0.6';
  const building = makeBuilding(dataDir, projects);
  const seen: unknown[] = [];
  let id = '';
  building.watchClones(() => seen.push(building.cloneProgress(id)));
  const r = await building.add('acme/game', 'Sam', (def) => (id = def.id), 'sam-account');
  assert.equal(typeof r, 'object', String(r));
  assert.deepEqual(seen.at(-1), { step: 'Downloading', percent: 42, detail: '1.00 MiB · 512.00 KiB/s' });
  assert.ok(existsSync(path.join(projects, 'acme', 'game', 'index.html')));
  assert.deepEqual(building.list().map((d) => d.repo), ['acme/game']);
  assert.deepEqual(building.pending(), []);
  assert.deepEqual(saved(), [], "the cloning document is gone once it's done");
  assert.deepEqual(readdirSync(path.join(dataDir, 'clones')), [], 'and so is its log');
});

test("a clone that goes quiet is stopped as stalled, and one that can't sign in says why", async (t) => {
  const { dataDir, projects, running } = office(t);
  process.env.FAKE_GH_HANG = '1';
  const building = makeBuilding(dataDir, projects);
  const r = building.add('acme/game', 'Sam', () => {}, 'sam-account');
  const pid = await running();
  assert.match(String(await r), /stalled/);
  await until(() => !alive(pid));
  assert.ok(!alive(pid), 'the clone was stopped');
  assert.deepEqual(building.pending(), []);

  delete process.env.FAKE_GH_HANG;
  process.env.FAKE_GH_FAIL = "fatal: could not read Username for 'https://github.com': terminal prompts disabled";
  assert.match(String(await building.add('acme/game', 'Sam', () => {}, 'sam-account')), /^Couldn't clone acme\/game: GitHub wouldn't let the office in.*Connections/);
  assert.deepEqual(building.list(), []);
});

test("a clone is the person's own: their GitHub's token goes to git in its environment, never to the command line or the log", async (t) => {
  const { root, dataDir, projects } = office(t);
  const seen = path.join(root, 'token');
  process.env.FAKE_GH_TOKEN_LOG = seen;
  const building = makeBuilding(dataDir, projects);
  assert.equal(typeof (await building.add('acme/game', 'Sam', () => {}, 'sam-account')), 'object');
  assert.equal(readFileSync(seen, 'utf8'), githubAuthEnv('gho_samstoken0123456789abcdef').GIT_CONFIG_VALUE_0);
  assert.match(readFileSync(seen, 'utf8'), /^Authorization: Basic /);
  // Ann hasn't a token to give (Composio keeps it): a public repository still clones, as herself.
  building.remove('game');
  rmSync(path.join(projects, 'acme'), { recursive: true, force: true });
  assert.equal(typeof (await building.add('acme/game', 'Ann', () => {}, 'ann-account')), 'object');
  assert.equal(readFileSync(seen, 'utf8'), '', 'no token, no header');
});

test("nobody adds a project without their own GitHub connected: not an account that hasn't, not the command line", async (t) => {
  const { dataDir, projects } = office(t);
  const building = makeBuilding(dataDir, projects);
  assert.match(String(await building.add('acme/game', 'Bob', () => {}, 'bob-account')), /Connect your GitHub first/);
  assert.match(String(await building.add('acme/game', 'Bob', () => {})), /Connect your GitHub first/);
  await assert.rejects(building.repos(false, 'bob-account'), /Connect your GitHub first/);
  assert.match(String(await building.add('acme/missing', 'Sam', () => {}, 'sam-account')), /Couldn't find acme\/missing on your GitHub: Not Found/);
  assert.deepEqual(building.list(), []);
});

test('a clone can be stopped by an admin or whoever added it', async (t) => {
  const { dataDir, projects, running } = office(t);
  process.env.FAKE_GH_HANG = '1';
  const building = makeBuilding(dataDir, projects, { clone: { tickMs: 50 } });
  let id = '';
  const r = building.add('acme/game', 'Sam', (def) => (id = def.id), 'sam-account');
  const pid = await running();
  assert.match(String(building.cancel(id, 'Ann stopped the clone', (owner) => owner === 'ann-account')), /Only admins/);
  assert.equal(building.cancel(id, 'Sam stopped the clone', (owner) => owner === 'sam-account'), undefined);
  assert.equal(await r, 'Sam stopped the clone');
  await until(() => !alive(pid));
  assert.ok(!alive(pid));
  assert.deepEqual(building.list(), []);
  assert.equal(building.cancel(id, 'again', () => true), 'No such floor');
});

test('a restart mid-clone picks the clone back up, and it becomes its floor', async (t) => {
  const { dataDir, projects, saved, running } = office(t);
  process.env.FAKE_GH_DELAY = '1';
  const first = makeBuilding(dataDir, projects);
  void first.add('acme/game', 'Sam', () => {}, 'sam-account');
  await running();
  // The office restarts (tsx watch, systemd): the clone carries on without it.
  first.shutdown(true);
  const second = makeBuilding(dataDir, projects);
  const done: (FloorDef | string)[] = [];
  second.resumeClones((r) => done.push(r));
  assert.deepEqual(second.pending().map((d) => d.repo), ['acme/game'], "it's on its way again");
  await until(() => done.length > 0);
  assert.equal(typeof done[0], 'object', String(done[0]));
  assert.deepEqual(second.list().map((d) => d.repo), ['acme/game']);
  assert.deepEqual(saved(), []);
  // Saved, so the next office has it too.
  assert.deepEqual(new Building(dataDir, projects).list().map((d) => d.repo), ['acme/game']);
});

test('a clone that finished while no office was watching becomes its floor at the next start', async (t) => {
  const { dataDir, projects, running } = office(t);
  process.env.FAKE_GH_DELAY = '0.3';
  const first = makeBuilding(dataDir, projects);
  void first.add('acme/game', 'Sam', () => {}, 'sam-account');
  const pid = await running();
  first.shutdown(true);
  await until(() => !alive(pid));
  const done: (FloorDef | string)[] = [];
  makeBuilding(dataDir, projects).resumeClones((r) => done.push(r));
  assert.equal(done.length, 1);
  assert.equal((done[0] as FloorDef).repo, 'acme/game');
});

test("a clone that was cut off isn't taken for a checkout", async (t) => {
  const { dataDir, projects } = office(t);
  const dest = path.join(projects, 'acme', 'game');
  execFileSync('git', ['init', '-q', dest]);
  execFileSync('git', ['-C', dest, 'remote', 'add', 'origin', 'https://github.com/acme/game.git']);
  const building = makeBuilding(dataDir, projects);
  assert.match(String(await building.add('acme/game', 'Sam', () => {}, 'sam-account')), /didn't finish/);
  assert.deepEqual(building.list(), []);
});
