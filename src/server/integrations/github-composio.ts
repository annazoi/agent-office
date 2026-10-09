// GitHub, one person at a time, through Composio: the repositories the signed-in person can see,
// whether one exists, and the token to clone it with, all from their own connected GitHub (the
// "github" toolkit, connected in ⚙️ Settings → Connections, or from the elevator itself). The
// office keeps no GitHub login of its own, so nobody clones with anyone else's access.
import { normalizeRepo } from '../../shared/building/floors.js';
import type { RepoChoice } from '../../shared/protocol.js';
import type { ComposioHub } from './composio.js';

/** Where the building asks about repositories (see Building.repoSource). */
export interface RepoSource {
  /** Why this account can't use GitHub yet, or undefined when it can (it has connected it). */
  blocked(account: string | undefined): Promise<string | undefined>;
  list(account: string): Promise<RepoChoice[]>;
  /** The repository's real name (case as GitHub has it) and whether it's empty; throws when it can't be seen. */
  view(account: string, repo: string): Promise<{ repo: string; empty: boolean }>;
  /** The account's GitHub token for git, when Composio hands it out (otherwise only public repositories clone). */
  token(account: string): Promise<string | undefined>;
}

type Data = Record<string, unknown>;
const s = (x: unknown, max = 300) => (typeof x === 'string' ? x.slice(0, max) : '');

export class ComposioGitHub implements RepoSource {
  constructor(private hub: ComposioHub) {}

  async blocked(account: string | undefined): Promise<string | undefined> {
    const why = this.hub.blocked(account);
    if (why) return why;
    if (!this.hub.toolkits.includes('github')) return 'GitHub is switched off in this office (an admin turns it on in ⚙️ Settings → Connections)';
    const mine = await this.hub.connections(account);
    if (mine.blocked) return mine.blocked;
    if (mine.toolkits.github !== 'connected') return 'Connect your GitHub first (☰ → ⚙️ Settings → Connections)';
    return undefined;
  }

  async list(account: string): Promise<RepoChoice[]> {
    const repos: RepoChoice[] = [];
    const seen = new Set<string>();
    // A page at a time, most recently pushed first; 5 pages is plenty for a picker.
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

  token(account: string): Promise<string | undefined> {
    return this.hub.githubToken(account);
  }
}
