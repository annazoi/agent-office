import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Claude's own settings in an account's folder: its first-run questions already answered. */
export function seedClaude(dir: string, change?: (c: any) => void) {
  const file = path.join(dir, '.claude.json');
  let c: any = {};
  try {
    c = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // new
  }
  const before = JSON.stringify(c);
  c.hasCompletedOnboarding = true;
  change?.(c);
  if (JSON.stringify(c) === before) return;
  try {
    writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error(`agent-office: couldn't write ${file}: ${(err as Error).message}`);
  }
}

/** Folders the office's own Claude trusts, the account's Claude trusts too: they're the same projects. */
export function trustProjects(configDir: string, dirs: string[], base: Record<string, string>) {
  let office: any;
  try {
    office = JSON.parse(readFileSync(base.CLAUDE_CONFIG_DIR ? path.join(base.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'), 'utf8'));
  } catch {
    return;
  }
  const trusted = (d: string) => office?.projects?.[d]?.hasTrustDialogAccepted === true;
  if (!dirs.some(trusted)) return;
  seedClaude(configDir, (c) => {
    c.projects ??= {};
    for (const d of dirs) c.projects[d] = { ...c.projects[d], hasTrustDialogAccepted: true };
  });
}
