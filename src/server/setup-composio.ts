// The first-run wizard's optional Composio step (see setup.ts): paste an API key, or Enter to skip;
// the office checks the key with Composio, asks which of Linear, Notion, Slack, Google Calendar and
// Gmail to show, and says where everyone connects their own accounts. The key goes in
// .agent-office/composio.json (mode 0600), as ⚙️ Settings → Connections would put it.
import { ComposioHub } from './integrations/composio.js';
import { COMPOSIO_TOOLKITS, COMPOSIO_TOOLKIT_META, type ComposioToolkit } from '../shared/protocol.js';

export interface ComposioStepIo {
  ask(question: string): Promise<string>;
  log(line?: string): void;
}

/** Picks toolkits out of "linear, slack" or "1 3 5"; every one of them for '' or "all". */
export function parseToolkitPick(answer: string): ComposioToolkit[] {
  const text = answer.trim().toLowerCase();
  if (!text || text === 'all') return [...COMPOSIO_TOOLKITS];
  const picked = new Set<ComposioToolkit>();
  for (const word of text.split(/[\s,]+/).filter(Boolean)) {
    const n = Number(word);
    if (Number.isInteger(n) && COMPOSIO_TOOLKITS[n - 1]) picked.add(COMPOSIO_TOOLKITS[n - 1]);
    for (const t of COMPOSIO_TOOLKITS) if (t === word || COMPOSIO_TOOLKIT_META[t].label.toLowerCase().replace(/\s+/g, '') === word.replace(/\s+/g, '') || t.startsWith(word)) picked.add(t);
  }
  return COMPOSIO_TOOLKITS.filter((t) => picked.has(t));
}

/**
 * Runs the step. Enter at the key skips it (and says how to do it later); a key that Composio
 * refuses can be tried again or skipped. Returns the toolkits switched on, or undefined if skipped.
 */
export async function composioStep(hub: ComposioHub, io: ComposioStepIo, officeUrl: string): Promise<ComposioToolkit[] | undefined> {
  const { ask, log } = io;
  log();
  if (hub.configured) {
    log(`  🔌 Composio is set up (${hub.toolkits.map((t) => COMPOSIO_TOOLKIT_META[t].label).join(', ') || 'no toolkits'}).`);
    if (!/^y/i.test(await ask('     Change it? [y/N] '))) return [...hub.toolkits];
  } else {
    log('  🔌 Composio puts Linear, Notion, Slack, Google Calendar and Gmail in the office as stations, and');
    log('     gives the workers those tools. Get an API key at https://app.composio.dev (optional).');
  }
  let toolkits: ComposioToolkit[] = [...COMPOSIO_TOOLKITS];
  for (;;) {
    const key = await ask('     Composio API key (Enter to skip): ');
    if (!key) {
      log('     Skipped. Admins can add it later in ⚙️ Settings → Connections, or with --composio-key.');
      return undefined;
    }
    log('     Checking the key with Composio…');
    const err = await hub.setKey(key, 'setup', toolkits);
    if (!err) break;
    log(`     ✗ ${err}`);
    if (!/^y/i.test(await ask('     Try another key? [Y/n] ') || 'y')) return undefined;
  }
  log('     ✓ The key works.');
  log();
  log('  🧰 Which toolkits should the office show? (Enter for all)');
  COMPOSIO_TOOLKITS.forEach((t, i) => log(`     ${i + 1}. ${COMPOSIO_TOOLKIT_META[t].icon} ${COMPOSIO_TOOLKIT_META[t].label} — the ${COMPOSIO_TOOLKIT_META[t].station}`));
  toolkits = parseToolkitPick(await ask('     Toolkits [all]: '));
  if (!toolkits.length) toolkits = [...COMPOSIO_TOOLKITS];
  hub.setToolkits(toolkits);
  log(`     ✓ ${toolkits.map((t) => COMPOSIO_TOOLKIT_META[t].label).join(', ')}`);
  log();
  log('  🔗 Each person connects their own accounts, so nobody sees anyone else\'s:');
  log(`     open ${officeUrl}, then ☰ → ⚙️ Settings → Connections, or press E at a station in the office.`);
  log('     (Connections need an account of your own: on the shared password alone there is nobody to connect as.)');
  return toolkits;
}
