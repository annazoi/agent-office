import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentEffort } from '../../../shared/protocol.js';
import { isRec, str } from './util.js';

export const DSH_PROFILE_DEFAULT = 'acp';
/** Where a floor keeps the sessions the office lists and resumes (under its .agent-office dir). */
export const DSH_SESSIONS_DIR = 'dsh-sessions';
export const DSH_PATCH_FILE = 'dsh-patch.yml';

/** The choices a select configuration option advertises, flattened across its groups. */
export function configOptionValues(option: unknown): { value: string; name?: string }[] {
  if (!isRec(option) || !Array.isArray(option.options)) return [];
  const values: { value: string; name?: string }[] = [];
  const add = (entry: unknown): void => {
    if (!isRec(entry)) return;
    const value = str(entry.value);
    if (value) values.push({ value, name: str(entry.name) });
  };
  for (const entry of option.options) {
    // Model options arrive grouped by provider: [{group, name, options: [...]}].
    if (isRec(entry) && Array.isArray(entry.options)) for (const inner of entry.options) add(inner);
    else add(entry);
  }
  return values;
}

/** The model inside an advertised route value, which DSH serializes as a JSON [provider, model] pair. */
function routeModel(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && typeof parsed[parsed.length - 1] === 'string') return String(parsed[parsed.length - 1]);
  } catch {
    // Not a route tuple: the value is already the id itself.
  }
  return undefined;
}

/**
 * Match what someone typed against the live catalog. DSH model values are opaque route tuples
 * (`["deepseek-official","deepseek-v4-pro"]`), so a person is far more likely to type the model
 * name: accept the exact value, the option's label, or the model inside the tuple. Anything that
 * matches nothing is passed through unchanged and the harness has the final say.
 */
export function resolveConfigValue(input: string, option: unknown): string {
  const wanted = input.trim();
  const values = configOptionValues(option);
  if (!values.length) return wanted;
  const exact = values.find((entry) => entry.value === wanted);
  if (exact) return exact.value;
  const byLabel = values.find((entry) => entry.name?.toLowerCase() === wanted.toLowerCase());
  if (byLabel) return byLabel.value;
  const byModel = values.find((entry) => (routeModel(entry.value) ?? '').toLowerCase() === wanted.toLowerCase());
  return byModel ? byModel.value : wanted;
}

/**
 * The office's effort levels on DSH's ladder (`off`, `low`, `high`, `max`). The office offers one
 * shared set for Claude and DSH, so the middle levels land on the nearest rung DSH has.
 */
export function dshEffort(effort: AgentEffort): string {
  if (effort === 'low') return 'low';
  if (effort === 'xhigh' || effort === 'max') return 'max';
  return 'high'; // medium and high: DSH's default balance
}

// ---------------------------------------------------------------------------
// Launch configuration
// ---------------------------------------------------------------------------

export function dshSessionsRoot(dataDir: string): string {
  return path.join(dataDir, DSH_SESSIONS_DIR);
}

/**
 * `dsh` argv: the office's own `--agent-args` first (so a DSH worker respects them), then the
 * profile, then the patch overlays. A trailing `--profile` wins over anything prepended.
 */
export function dshArgs(options: { profile: string; patches?: string[]; extra?: string[] }): string[] {
  const args = [...(options.extra ?? [])];
  args.push('--profile', options.profile);
  for (const patch of options.patches ?? []) args.push('--patch', patch);
  return args;
}

/**
 * The patch overlay that keeps a floor's DSH sessions under the office's own directory instead of
 * the user's `~/.dsh/sessions`, so the office can list and resume exactly what it started.
 * Written once per floor; the same file serves every DSH worker on it.
 */
export function writeDshPatch(dataDir: string): string {
  const file = path.join(dataDir, DSH_PATCH_FILE);
  const body = [
    '# Written by the office: keep DeepSeek Harness sessions in this checkout.',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${JSON.stringify(dshSessionsRoot(dataDir))}`,
    '',
  ].join('\n');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(file, body, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export interface DshLaunch {
  /** The executable to run: the configured `dsh`, or one a test points at a fake agent. */
  file: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** A model chosen for this worker, applied through `session/set_config_option`. */
  model?: string;
  effort?: AgentEffort;
  /** The session to carry on, when there is one (R on an exited worker, or a restart). */
  resumeSessionId?: string;
  /** Sent as the first prompt once the session is ready. */
  firstPrompt?: string;
}
