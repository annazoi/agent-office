// The elevator's GitHub, through the GitHub CLI: the repositories its login can clone, and a clone
// run in the terminal (`agent-office setup`). The office's Building (building.ts) uses these, and
// falls back to Composio's GitHub where gh isn't installed (github-composio.ts).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { normalizeRepo } from '../../shared/floors.js';
import type { RepoChoice } from '../../shared/protocol.js';
import { gh } from './github.js';

const MAX_REPOS = 1000;

/** Clones `repo` to `dest` in this terminal: git shows its progress, and ssh or git can ask here. Resolves to an error, if any. */
export function cloneHere(repo: string, dest: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn('gh', ['repo', 'clone', repo, dest], { cwd: path.dirname(dest), stdio: 'inherit' });
    child.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'ENOENT' ? "The GitHub CLI (gh) isn't installed on this machine" : `Couldn't run gh: ${err.message}`));
    child.once('exit', (code, signal) => resolve(code === 0 ? undefined : `Couldn't clone ${repo}: gh ${signal ? `stopped (${signal})` : `failed (exit ${code})`}`));
  });
}

export async function listRepos(cwd: string): Promise<RepoChoice[]> {
  const out = await gh(
    [
      'api',
      '--paginate',
      'user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      '--jq',
      '.[] | {name: .full_name, description: (.description // ""), private: .private, pushedAt: .pushed_at}',
    ],
    cwd,
    90_000,
  );
  const repos: RepoChoice[] = [];
  const seen = new Set<string>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { name?: unknown; description?: unknown; private?: unknown; pushedAt?: unknown };
      const name = normalizeRepo(r.name);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      repos.push({
        name,
        description: typeof r.description === 'string' && r.description ? r.description.slice(0, 200) : undefined,
        private: r.private === true,
        pushedAt: typeof r.pushedAt === 'string' ? r.pushedAt : undefined,
      });
    } catch {
      // not a line of ours
    }
    if (repos.length >= MAX_REPOS) break;
  }
  return repos.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
}
