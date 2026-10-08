// GitHub through Composio, for the elevator where the GitHub CLI isn't installed: the repositories
// the signed-in person can see, and whether one exists, from their own connected GitHub (the
// "github" toolkit, connected in ⚙️ Settings → Connections). Cloning itself is git's (clone.ts):
// Composio never hands out the account's token, so a private repository still needs git to have a
// way in of its own (an ssh key, or a credential helper), as the error says when it doesn't.
import { normalizeRepo } from '../../shared/floors.js';
import type { RepoChoice } from '../../shared/protocol.js';
import type { ComposioHub } from './composio.js';

/** Where the building asks about repositories when `gh` can't answer (see Building.repoSource). */
export interface RepoSource {
  /** Whether this account could answer at all (it has GitHub connected), so a `gh` error is worth falling back from. */
  ready(account: string): boolean;
  list(account: string): Promise<RepoChoice[]>;
  /** The repository's real name (case as GitHub has it) and whether it's empty; throws when it can't be seen. */
  view(account: string, repo: string): Promise<{ repo: string; empty: boolean }>;
}

type Data = Record<string, unknown>;
const s = (x: unknown, max = 300) => (typeof x === 'string' ? x.slice(0, max) : '');

export class ComposioGitHub implements RepoSource {
  constructor(private hub: ComposioHub) {}

  ready(account: string): boolean {
    return this.hub.configured && this.hub.toolkits.includes('github') && !this.hub.blocked(account) && this.hub.connectedTo(account, 'github');
  }

  async list(account: string): Promise<RepoChoice[]> {
    const repos: RepoChoice[] = [];
    const seen = new Set<string>();
    // A page at a time, most recently pushed first, as `gh api --paginate` would; 5 pages is plenty for a picker.
    for (let page = 1; page <= 5; page++) {
      const d = await this.hub.execute(account, 'github', 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER', { per_page: 100, page, sort: 'pushed', direction: 'desc', type: 'all' });
      const items = Array.isArray(d.repositories) ? (d.repositories as Data[]) : [];
      for (const r of items) {
        const name = normalizeRepo(r.full_name);
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        repos.push({ name, description: s(r.description, 200) || undefined, private: r.private === true, pushedAt: s(r.pushed_at, 40) || undefined });
      }
      if (items.length < 100) break;
    }
    return repos;
  }

  async view(account: string, repo: string): Promise<{ repo: string; empty: boolean }> {
    const [owner, name] = repo.split('/');
    if (!owner || !name) throw new Error(`${repo} isn't owner/name`);
    const d = await this.hub.execute(account, 'github', 'GITHUB_GET_A_REPOSITORY', { owner, repo: name });
    const full = normalizeRepo(d.full_name) ?? repo;
    // GitHub reports a repository with nothing pushed yet as size 0 (kilobytes).
    return { repo: full, empty: d.size === 0 };
  }
}
