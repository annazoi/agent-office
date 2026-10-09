import os from 'node:os';
import path from 'node:path';
import tty from 'node:tty';
// A .env file where the office starts (DATABASE_URL and the like), if there is one.
import 'dotenv/config';
import { ConfigDone, loadConfig, ensureSelfSigned, type Config } from './config.js';
import { openDatabase, takeDatabaseUrl } from './db/postgres.js';
import { stateDb, useStateDb } from './db/state.js';
import { startServer } from './server.js';
import { tildify } from './floor/building.js';
import { openBrowser } from './browser.js';

const argv = process.argv.slice(2);
if (argv[0] === 'tunnel') {
  // On your own computer, for an office somewhere else: it has no database of its own.
  const { tunnelCommand } = await import('./tunnel/index.js');
  process.exit(await tunnelCommand(argv.slice(1)));
}
// Everything the office keeps is in its database, so every other command opens it first.
const url = takeDatabaseUrl(argv);
if (!argv.includes('-h') && !argv.includes('--help')) useStateDb(await openDatabase(url));
/** Exits once what the command changed is in the database. */
const done = async (code: number) => {
  await stateDb().close().catch(() => {});
  process.exit(code);
};
if (argv[0] === 'prune') {
  const { prune } = await import('./prune.js');
  await done(await prune(argv.slice(1)));
}
if (argv[0] === 'accounts') {
  const { accountsCommand } = await import('./accounts/accounts.js');
  await done(await accountsCommand(argv.slice(1)));
}

let cfg: Config;
try {
  cfg = loadConfig(argv);
} catch (err) {
  if (err instanceof ConfigDone) await done(err.code);
  throw err;
}
await ensureSelfSigned(cfg);
// Someone's at a terminal (asked of the file descriptors, not process.stdin: on Windows, opening stdin
// when another process is reading it, as `npm run dev` does, blocks forever).
const atTerminal = tty.isatty(1) && tty.isatty(0) && !process.env.CI;

let office: Awaited<ReturnType<typeof startServer>>;
try {
  office = await startServer(cfg);
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') console.error(`agent-office: port ${cfg.port} is already in use (try --port)`);
  else console.error(`agent-office: ${e.message}`);
  process.exit(1);
}

const scheme = cfg.tls ? 'https' : 'http';
const everywhere = cfg.host === '0.0.0.0' || cfg.host === '::';
const loopback = cfg.host === 'localhost' || cfg.host === '::1' || cfg.host.startsWith('127.');
// Where this machine's browser finds the office: localhost, unless it's bound to one other address.
const here = `${scheme}://${everywhere || loopback ? 'localhost' : cfg.host}:${cfg.port}`;
const urls = new Set<string>([here]);
if (everywhere) {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) urls.add(`${scheme}://${ni.address}:${cfg.port}`);
  }
}

const agent = office.resolvedAgent;
function floorsLine() {
  const floors = office.floors();
  const where = `new ones are cloned into ${tildify(office.projectsDir())}`;
  return `🛗 ${floors.length} floor${floors.length === 1 ? '' : 's'}: ${floors.map((f) => f.def.name).join(', ')} (${where})`;
}

function passwordLine() {
  if (office.accounts.any && !office.accounts.openRegistration) return 'not needed — registration is closed, new people come in by invite (agent-office accounts)';
  if (!cfg.passwordGenerated) return '(from --password / AGENT_OFFICE_PASSWORD)';
  if (cfg.claimToken && !cfg.claimed) return 'shown exactly once to whoever opens the claim link (/claim?t=…)';
  if (cfg.claimed || !cfg.password) return '(already claimed — never shown again; reset with --reset-password)';
  return cfg.password;
}

// Someone started it in a terminal: a link that lets them register once, opened in their browser,
// so there's no password to copy (the first account is the office's admin). Not for an office
// that's claimed from a link (deploy/provision.sh).
let signIn = '';
let opened = false;
if (atTerminal && !cfg.claimToken) {
  signIn = here + office.signInLink();
  if (cfg.open) opened = openBrowser(signIn);
}

// Started in a project that's still one of the floors (it can be taken off like any other).
const local = cfg.project && office.floors().some((f) => path.resolve(f.def.dir) === cfg.project);
console.log(`
  🏢  agent-office is open${local ? ` for ${cfg.project}` : ''}

  ${floorsLine()}

  ${[...urls].join('\n  ')}${loopback ? '\n  (only this computer can open it: --host 0.0.0.0 lets your network in)' : ''}
${signIn ? `\n  register: ${signIn}\n            ${opened ? 'opened in your browser; ' : ''}the link works once (or sign in, if you have an account)\n` : ''}
  password: ${passwordLine()}
  default agent: ${[agent ?? `${cfg.agentCmd} (via login shell)`, ...cfg.agentArgs].join(' ')}
  choose a provider (including Pi and Cursor) when hiring or queueing a task
${cfg.tls || loopback ? '' : '\n  tip: voice & screen share need https off localhost — use a reverse proxy or --self-signed\n'}`);

let closing = false;
// SIGTERM is a restart (tsx watch reloading, a plain `kill`, systemd): workers keep running in their
// terminal host and the next office picks them back up. Ctrl+C closes the office and stops them.
// (Under systemd that needs KillMode=process, or stopping the service stops the host with it; see
// deploy/provision.sh. Workers cut off that way are resumed and carry on.)
const stop = (signal: NodeJS.Signals) => {
  if (closing) process.exit(1);
  closing = true;
  const keep = signal === 'SIGTERM';
  console.log(keep ? '\n  closing the office — workers keep running for the next one…' : '\n  closing the office…');
  office.shutdown(keep);
  // Whatever the office saved on its way out goes to the database before it exits (or gives up after a few seconds).
  const exit = () => process.exit(0);
  setTimeout(exit, 5000).unref();
  void new Promise((r) => setTimeout(r, 300)).then(() => stateDb().close()).finally(exit);
};
// Last line of defense: one bad request must never take down every running worker.
process.on('unhandledRejection', (err) => console.error('agent-office: unhandled rejection', err));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
