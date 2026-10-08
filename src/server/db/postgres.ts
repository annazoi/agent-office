// The office's Postgres database (Neon or any Postgres): one table of JSON documents by key (see
// state.ts). Required: the office won't start without --database-url / DATABASE_URL.
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { officeHome } from '../config.js';
import { StateDb, type Backend } from './state.js';

const { Pool } = pg;

const TABLE = 'create table if not exists office_state (key text primary key, value jsonb not null, updated_at timestamptz not null default now())';

export function postgresBackend(url: string): Backend {
  const pool = new Pool({ connectionString: url, max: 5 });
  pool.on('error', (err) => console.error('agent-office: database connection error:', err.message));
  let ready: Promise<unknown> | undefined;
  const table = () => (ready ??= pool.query(TABLE).catch((err) => {
    ready = undefined;
    throw err;
  }));
  return {
    async loadAll() {
      await table();
      // ::text keeps the JSON exactly as written, rather than parsed and stringified again.
      const { rows } = await pool.query<{ key: string; value: string }>('select key, value::text as value from office_state');
      return new Map(rows.map((r) => [r.key, r.value]));
    },
    async load(key) {
      await table();
      const { rows } = await pool.query<{ value: string }>('select value::text as value from office_state where key = $1', [key]);
      return rows[0]?.value;
    },
    async loadPrefix(prefix) {
      await table();
      const { rows } = await pool.query<{ key: string; value: string }>('select key, value::text as value from office_state where left(key, length($1)) = $1', [prefix]);
      return new Map(rows.map((r) => [r.key, r.value]));
    },
    async write(key, json) {
      await table();
      await pool.query('insert into office_state (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = $2::jsonb, updated_at = now()', [key, json]);
    },
    async remove(key) {
      await table();
      await pool.query('delete from office_state where key = $1', [key]);
    },
    async close() {
      await pool.end();
    },
  };
}

const fromEnv = () => (process.env.DATABASE_URL || process.env.AGENT_OFFICE_DATABASE_URL || '').trim() || undefined;

/**
 * The database URL from --database-url (taken out of `argv`, so no command after has to know it),
 * DATABASE_URL or AGENT_OFFICE_DATABASE_URL, or else the .env file in the office's home folder
 * (~/agent-office/.env, or --home's), which deploy/provision.sh and the container write, so a
 * command run over ssh (`agent-office accounts …`) finds the same database as the office.
 */
export function takeDatabaseUrl(argv: string[]): string | undefined {
  let given: string | undefined;
  for (let i = argv.indexOf('--database-url'); i >= 0; i = argv.indexOf('--database-url')) {
    given = argv[i + 1];
    argv.splice(i, given === undefined ? 1 : 2);
  }
  if (given?.trim()) return given.trim();
  if (!fromEnv()) {
    const home = argv.indexOf('--home');
    const dir = home >= 0 && argv[home + 1] ? path.resolve(argv[home + 1]) : officeHome();
    dotenv.config({ path: path.join(dir, '.env'), quiet: true });
  }
  return fromEnv();
}

export const NO_DATABASE = `agent-office needs a Postgres database to keep the office in (Neon or any Postgres).
Pass --database-url <url>, or set DATABASE_URL (a .env file in the folder you start it from, or in
~/agent-office, works too), e.g.

  DATABASE_URL=postgres://user:password@localhost:5432/agent_office agent-office
`;

/** Opens the office's database and loads it, or says why it can't and exits. */
export async function openDatabase(url: string | undefined, who = 'agent-office'): Promise<StateDb> {
  if (!url) {
    process.stderr.write(NO_DATABASE);
    process.exit(2);
  }
  const backend = postgresBackend(url);
  try {
    return await StateDb.open(backend);
  } catch (err) {
    console.error(`${who}: couldn't open the database: ${(err as Error).message}`);
    await backend.close().catch(() => {});
    process.exit(1);
  }
}
