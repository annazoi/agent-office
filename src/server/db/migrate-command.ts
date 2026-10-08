// `agent-office migrate [dir]`: brings an office from before the database over from its JSON files
// now, rather than the first time it starts (see migrate.ts, which every start runs anyway).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { officeHome } from '../config.js';
import { hasLegacyOffice, migrateLegacyOffice } from './migrate.js';
import { stateDb } from './state.js';

const HELP = `agent-office migrate — bring an office's JSON files over into its database

Usage:
  agent-office migrate [dir]

Reads the office in dir (default: the current directory if an office ran there, else
~/agent-office or $AGENT_OFFICE_HOME): its password, accounts and invites, floors, chat
and settings, and each floor's workers, queue, decor and the rest. It writes only what the
database doesn't have yet, and leaves the files as they were. The office does this by itself
the first time it starts there; this is for doing it beforehand.
`;

export async function migrateCommand(argv: string[]): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP);
    return 0;
  }
  const dir = argv[0] ? path.resolve(argv[0]) : existsSync(path.join(process.cwd(), '.agent-office', 'config.json')) ? process.cwd() : officeHome();
  if (!hasLegacyOffice(dir)) {
    console.log(`agent-office migrate: nothing to bring over in ${dir} (no .agent-office/config.json, or the database has that office already)`);
    return 0;
  }
  migrateLegacyOffice(dir);
  await stateDb().flush();
  return 0;
}
