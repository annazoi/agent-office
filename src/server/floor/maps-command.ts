// `agent-office maps`: the maps of your own, which the office keeps in its database (see maps.ts).
// A map you wrote is added from its file (or stdin) once; after that it's the database's, and the
// running office picks it up within seconds.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkCustomMaps } from '../../shared/building/maps/index.js';
import { officeHome, officeRanIn } from '../config.js';
import { stateDb } from '../db/state.js';
import { MAP_NAME_RE, MAX_MAPS, MAX_MAP_BYTES, customMapsKey } from './maps.js';

const HELP = `agent-office maps — the building's maps of your own

Usage:
  agent-office maps [list]                     The maps of your own, and whether each one loads
  agent-office maps add <file.json | -> [name] Add a map (or replace the one of that name) from a
                                               file you wrote, or from stdin with -. The name is the
                                               file's, without .json, unless you give one
  agent-office maps remove <name>              Take a map away

Options:
  -d, --dir <dir>   The office's directory (default: the current directory if an office ran there,
                    else ~/agent-office or $AGENT_OFFICE_HOME)
  -h, --help        Show this help

docs/maps.md says how to write one; docs/maps/castle.json is a start. Pick it in ⚙️ Settings.
Works while the office runs: it picks up the change within seconds.
`;

/** `agent-office maps …`: exits 0 when done, 1 when it couldn't, 2 for a usage error. */
export async function mapsCommand(argv: string[]): Promise<number> {
  let dir = officeRanIn(process.cwd()) ? process.cwd() : officeHome();
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      return 0;
    } else if (a === '-d' || a === '--dir') {
      if (!argv[i + 1]) return usage('--dir needs a value');
      dir = path.resolve(argv[++i]);
    } else if (a.startsWith('-') && a !== '-') return usage(`unknown option ${a}`);
    else args.push(a);
  }
  if (!officeRanIn(dir)) return fail(`no office has run in ${dir} yet — start it once with \`agent-office\` there`);
  const prefix = customMapsKey(path.join(dir, '.agent-office'));
  const db = stateDb();
  const names = () => db.keys(prefix).map((k) => k.slice(prefix.length)).sort();
  const [cmd = 'list', arg, arg2] = args;
  switch (cmd) {
    case 'list': {
      const all = names();
      if (!all.length) console.log('No maps of your own yet: agent-office maps add <file.json>');
      const checked = checkCustomMaps(all.map((file) => ({ file, json: db.get<unknown>(prefix + file) })));
      for (const m of checked) console.log(`  ${m.file.padEnd(24)}  ${m.config ? `${m.config.name} (${m.config.id})` : `✗ ${m.error}`}`);
      return 0;
    }
    case 'add': {
      if (!arg) return usage('add needs a file, or - for stdin');
      let text: string;
      try {
        text = readFileSync(arg === '-' ? 0 : path.resolve(arg), 'utf8');
      } catch (err) {
        return fail(`couldn't read ${arg}: ${(err as Error).message}`);
      }
      if (Buffer.byteLength(text) > MAX_MAP_BYTES) return fail(`it's over ${MAX_MAP_BYTES / 1024} KB`);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (err) {
        return fail(`it isn't valid JSON (${(err as Error).message})`);
      }
      const name = arg2 ?? (arg === '-' ? '' : path.basename(arg).replace(/\.json$/i, ''));
      if (!MAP_NAME_RE.test(name)) return usage(`give it a name of letters, digits, - and _ (${name ? `not "${name}"` : 'stdin has none'})`);
      if (!names().includes(name) && names().length >= MAX_MAPS) return fail(`the office reads only ${MAX_MAPS} maps: remove one first`);
      // Checked with the others, as the office will: a map that won't load isn't kept.
      const others = names().filter((n) => n !== name);
      const checked = checkCustomMaps([...others.map((file) => ({ file, json: db.get<unknown>(prefix + file) })), { file: name, json }]);
      const mine = checked.find((m) => m.file === name)!;
      if (!mine.config) return fail(`that map won't load: ${mine.error}`);
      db.set(prefix + name, json);
      await db.flush();
      console.log(`Added ${name}: ${mine.config.name}. Pick it in ⚙️ Settings → 🏢 Building.`);
      return 0;
    }
    case 'remove': {
      if (!arg) return usage('remove needs a name');
      if (!names().includes(arg)) return fail(`there's no map called ${arg}`);
      db.delete(prefix + arg);
      await db.flush();
      console.log(`Removed ${arg}. If the building was on it, it's back to the office.`);
      return 0;
    }
    default:
      return usage(`unknown command ${cmd}`);
  }
}

function usage(msg: string): number {
  console.error(`agent-office maps: ${msg}\n`);
  process.stderr.write(HELP);
  return 2;
}

function fail(msg: string): number {
  console.error(`agent-office maps: ${msg}`);
  return 1;
}
