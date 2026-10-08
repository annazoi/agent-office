import { createInterface } from 'node:readline/promises';
import type { Office } from './office.js';

// Signing `agent-office tunnel` in to the office: by asking for your name and password in the
// terminal (or taking them from the command line). The session is what a browser's cookie is; it's
// kept in memory for as long as the tunnel runs, so a tunnel that reconnects doesn't ask again.
// Nothing is written to disk: everything the office keeps is in its database, which this computer
// has no part of.

/** The sessions this run has, one per office. */
const sessions = new Map<string, string>();

/** Keeps the session for this office (or, without one, forgets it). */
function keep(office: string, token: string | undefined) {
  if (token) sessions.set(office, token);
  else sessions.delete(office);
}

/** Someone's at a terminal to answer questions. */
const interactive = () => !!process.stdin.isTTY && !!process.stdout.isTTY;

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Asks without showing what's typed. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve) => {
    let typed = '';
    const done = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (text.startsWith('\u001b')) return; // an arrow key or the like
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') {
          done();
          return resolve(typed);
        }
        // Ctrl-C and Ctrl-D: the terminal isn't sending signals while it hides the typing.
        if (ch === '\u0003' || ch === '\u0004') {
          done();
          process.emit('SIGINT');
          return;
        }
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1);
        else if (ch >= ' ') typed += ch;
      }
    };
    // Before the question shows: what's typed the moment it does mustn't be echoed either.
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdout.write(question);
  });
}

export interface Credentials {
  /** The account to sign in as; asked for when missing. */
  name?: string;
  password?: string;
}

/**
 * Signs in to the office: with the session this run already has (`key` names the office), else
 * the password given, else by asking. Resolves to why it couldn't, or '' when
 * `office.token` is good.
 */
export async function signIn(office: Office, key: string, given: Credentials, say: (line: string) => void): Promise<string> {
  const kept = sessions.get(key);
  if (kept) {
    office.token = kept;
    if ((await office.forwards()) !== 'signed-out') return '';
    office.token = '';
    keep(key, undefined);
  }
  if (given.password !== undefined) {
    const err = await office.signIn(given.name ?? '', given.password);
    if (!err) keep(key, office.token);
    // AGENT_OFFICE_PASSWORD may be another office's (one that runs on this computer): ask instead.
    if (!err || !interactive()) return err;
    say(`  ${err}`);
  }
  if (!interactive()) return 'Not signed in. Run it in a terminal to type your name and password, or pass --name and set AGENT_OFFICE_PASSWORD to your account\'s password.';

  say(`  Sign in to the office at ${office.origin} (asked once while this tunnel runs)`);
  for (let tries = 0; tries < 3; tries++) {
    const name = given.name ?? (await ask('  Your name: '));
    const err = await office.signIn(name, await askHidden('  Password: '));
    if (!err) {
      keep(key, office.token);
      return '';
    }
    say(`  ${err}`);
    if (/too many/i.test(err)) return err;
  }
  return 'Sign-in failed';
}

/** The session stopped working (the password changed, the account was revoked): forget it. */
export function forget(office: Office, key: string) {
  office.token = '';
  keep(key, undefined);
}
