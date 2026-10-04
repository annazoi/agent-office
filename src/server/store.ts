// An optional Postgres store (Neon or any Postgres), for office state that otherwise lives only in a
// JSON file next to the project: accounts and the Composio key, so far. Each caller gets one row,
// keyed by name, holding the exact same shape it used to write to its file — this doesn't change
// what's stored, only where. Without --database-url / DATABASE_URL, nothing here is used and every
// file keeps working exactly as it always did.
import pg from 'pg';

const { Pool } = pg;

export interface RowStore {
  /** The row for `key`, or `undefined` when there isn't one yet (a fresh database, or never saved). */
  read<T>(key: string): Promise<T | undefined>;
  /** Replaces the row for `key` whole, the same way a JSON file is written whole. */
  write(key: string, value: unknown): Promise<void>;
}

const pools = new Map<string, InstanceType<typeof Pool>>();
const ready = new Map<string, Promise<void>>();

function pool(url: string): InstanceType<typeof Pool> {
  let p = pools.get(url);
  if (!p) {
    p = new Pool({ connectionString: url, max: 5 });
    p.on('error', (err) => console.error('agent-office: database connection error:', err.message));
    pools.set(url, p);
  }
  return p;
}

function ensureTable(url: string): Promise<void> {
  let r = ready.get(url);
  if (!r) {
    r = pool(url)
      .query('create table if not exists office_state (key text primary key, value jsonb not null, updated_at timestamptz not null default now())')
      .then(() => undefined);
    ready.set(url, r);
  }
  return r;
}

/** A row store backed by `url` (e.g. a Neon connection string). The table is created on first use. */
export function postgresStore(url: string): RowStore {
  return {
    async read<T>(key: string): Promise<T | undefined> {
      await ensureTable(url);
      const { rows } = await pool(url).query<{ value: T }>('select value from office_state where key = $1', [key]);
      return rows[0]?.value;
    },
    async write(key: string, value: unknown): Promise<void> {
      await ensureTable(url);
      await pool(url).query('insert into office_state (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = $2::jsonb, updated_at = now()', [
        key,
        JSON.stringify(value),
      ]);
    },
  };
}
