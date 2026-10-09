// The office's own floor (HOME_FLOOR): a folder of its own in the office's data, made a git
// repository with one empty commit so workers there get worktrees and branches like anywhere else.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** Makes `dir` ready to be the office's floor, if it isn't yet. Returns it. */
export function prepareHome(dir: string): string {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(path.join(dir, '.git'))) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=agent-office', '-c', 'user.email=agent-office@localhost', 'commit', '-q', '--allow-empty', '-m', 'The office');
  }
  return dir;
}
