import { execFile } from 'node:child_process';
import { closeSync, openSync, readSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Commits everything in a checkout but `leaveOut` (the notes); resolves to the commit's short hash, or
 * undefined when there was nothing to commit.
 */
export async function commitAll(cwd: string, message: string, leaveOut: string): Promise<string | undefined> {
  const git = async (args: string[]) => (await execFileP('git', args, { cwd, encoding: 'utf8', timeout: 60_000 })).stdout.trim();
  await git(['add', '-A', '--', '.', `:(exclude)${leaveOut}`]);
  if (!(await git(['diff', '--cached', '--name-only']))) return undefined;
  await git(['commit', '-q', '-m', message]);
  return git(['rev-parse', '--short', 'HEAD']);
}

/** The start of a file, at most `bytes` of it. */
export function readStart(file: string, bytes: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8').replace(/�+$/, '');
  } finally {
    closeSync(fd);
  }
}

/** Roles that repeat get numbered, so each worker at the table has one of its own: Engineer 1, Engineer 2. */
export function numbered(roles: string[]): string[] {
  const seen = new Map<string, number>();
  const count = new Map<string, number>();
  for (const r of roles) count.set(r.toLowerCase(), (count.get(r.toLowerCase()) ?? 0) + 1);
  return roles.map((r) => {
    const key = r.toLowerCase();
    if ((count.get(key) ?? 0) < 2) return r;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `${r} ${n}`;
  });
}

/** "a", "a and b", "a, b and c". */
export function list(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function firstLine(s: string): string {
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
