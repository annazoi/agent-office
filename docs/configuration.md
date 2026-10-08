# Configuration

Back to the [README](../README.md).

## Where the office keeps things

**The database.** Everything the office remembers lives in its PostgreSQL database, which it won't start without: `--database-url`, or `DATABASE_URL` / `AGENT_OFFICE_DATABASE_URL` (a `.env` file in the folder it starts in is read too). A [Neon](https://neon.tech) database works, or any Postgres. In it are the office's config (the password's hash, the key sessions are signed with, the self-signed certificate), the accounts and open invites, **each account's own settings** (its character, sound and panels, board filters, best laps and the rest the browser used to keep for itself) and which logins it picked, the floors, the chat, the spend, the arcade's scores, and each floor's workers, queue, decor, plan, whiteboard, jukebox, meetings and so on. It's one table, `office_state`: a row of JSON per thing, keyed by the folder it belongs to and its name (`/home/me/agent-office/.agent-office|floors`, `…|users/<account>/config`), so several offices can share a database. Nothing of it is written to JSON files any more. An office from before keeps everything: the first time anything opens it (the office starting, or `agent-office accounts`, `maps`, `setup`), its `.agent-office/*.json` files and each of its floors' are brought over into the database, never over something the database already has, and the files are left as they were (`agent-office migrate [dir]` does it beforehand; `src/server/db/migrate.ts`). The office reads it all as it starts and writes each change back as it happens, and the `agent-office accounts`, `setup` and `prune` commands use the same database. The tests use an in-memory stand-in (`tests/support/db.ts`).

What stays on disk is the work itself and what other programs read for themselves: workers' worktrees and the clones under way, each account's own Claude and GitHub logins (`.agent-office/homes/<account>/`, where `claude` and `gh` keep them). No JSON file is written anywhere: Claude Code gets its hooks and MCP servers as JSON on its command line (a Composio key in an environment variable it reads), and Cursor, Grok and Muse, which only read hooks from files, get none, so those workers are followed by their terminals alone. Maps of your own are in the database too: `agent-office maps add <file.json>` adds one.

**Folders.** The office keeps its folder in `~/agent-office` (`--home` or `AGENT_OFFICE_HOME` to move it) and clones projects next to it, as `~/agent-office/<owner>/<repo>`. To clone them somewhere else, like `~/Workspace`, an admin picks the **Workspace folder** in ⚙️ Settings → **🏢 Building** (or start with `--projects` or `AGENT_OFFICE_PROJECTS`). Floors you already have stay where they are, and a checkout of the same repository that's already in the new folder is used as it is. Maps of your own are added with `agent-office maps add` (see [Maps](maps.md)), and each account's own Claude and GitHub logins are in `~/agent-office/.agent-office/homes/<account>/` (revoking the account deletes them). The office's Composio API key and the toolkits it shows are in the database; the connections themselves live in Composio, per account (see the README's [Composio integrations](../README.md#composio-integrations)). Each floor's worktrees are in its own checkout's `.agent-office/`; its workers, queue and pictures are in the database, under that folder.

Already have a checkout? Pick its repository anyway: a checkout of it that's already where the workspace folder would clone it is used as it is. You can still start the office in a project, `agent-office ~/code/my-project`: that project becomes a floor, and the office keeps its data in `~/code/my-project/.agent-office` as it did before there were floors. An office that already ran in a project carries on in it when you start `agent-office` there again (with the same database). An admin can take that project off the building in the elevator like any other floor.

## Command line

```
agent-office [dir] [options]

      --home <dir>        Where the office keeps its data without a [dir] (default ~/agent-office)
      --projects <dir>    Where new floors are cloned, as <dir>/<owner>/<repo> (default ~/agent-office;
                          also settable from ⚙️ Settings)
  -p, --port <n>          Port (default 4600, env PORT)
  -H, --host <addr>       Bind address (default 127.0.0.1; 0.0.0.0 lets your network in)
      --database-url <url>
                          The Postgres database the office keeps everything in; required
                          (env DATABASE_URL or AGENT_OFFICE_DATABASE_URL, or a .env file)
      --password <pw>     Office password, what people register their accounts with
                          (env AGENT_OFFICE_PASSWORD; generated once when not given)
      --no-open           Don't open the office in your browser when it starts
      --agent <cmd>       Default agent command (default "claude")
      --agent-args <str>  Extra args for the configured agent, e.g. "--model opus"
      --dsh-profile <n>   DeepSeek Harness profile over ACP (default "acp")
      --tls-cert <file>   Serve HTTPS with this cert…
      --tls-key <file>    …and key
      --self-signed       Serve HTTPS with a generated self-signed cert
      --trust-proxy       Trust X-Forwarded-* (behind Caddy/nginx)
      --turn <url>        Add a TURN server for voice, e.g. turn:user:pass@host:3478
                          (env AGENT_OFFICE_TURN, several separated by spaces)
      --budget <usd>      Daily tracked Claude Code budget (OpenCode/Codex/Grok/Muse/DSH excluded)
      --budget-pause      ...and nobody can hire a new worker until the next day
      --max-workers <n>   Run at most n workers at once, across every floor (env AGENT_OFFICE_MAX_WORKERS)
      --webhook <url>     Post to this Slack / Discord webhook when a worker needs input or finishes
      --composio-key <k>  Composio API key for the Linear, Notion, Slack, Calendar and Gmail stations (env AGENT_OFFICE_COMPOSIO_API_KEY; "" removes it)
      --composio-toolkits <list>
                          Which of linear, notion, slack, googlecalendar, gmail to show (env AGENT_OFFICE_COMPOSIO_TOOLKITS; default all)
      --city <name>       Put the office in a real city: its sun and live weather (open-meteo.com)
      --weather <kind>    Pin the weather: clear, cloudy, rain, storm, snow or fog
      --real-time-sky     Start the sky on the real clock, not a day an hour (env AGENT_OFFICE_SKY_CLOCK=real; ⚙️ Settings can switch it)

agent-office setup [--projects <dir> | --default-projects <dir>] [--project <owner/repo>]... [--home <dir>]

  The first-start walkthrough again: the workspace folder, GitHub sign-in and
  repositories to clone as floors. With --projects / --project it asks nothing.
  --default-projects sets the folder only if nobody has picked one yet (the
  container runs it at every start).
  Run it while the office is stopped.

agent-office prune [dir] [-n|--dry-run] [-f|--force]

  Removes leftover worker worktrees under .agent-office/worktrees/ and their
  office/* branches, in one floor's checkout (dir). Anything with uncommitted changes or unpushed commits is
  kept unless --force is given. A worker across several projects has worktrees of them in its
  own floor's workspace: prune each project to clear those out.

agent-office migrate [dir]

  Brings an office from before the database over from its JSON files (the office does it by
  itself the first time it starts there).

agent-office accounts [list | invite [name] [--admin] | revoke <name> | role <name> admin|member | registration on|off] [-d <dir>]

  Invite, list and revoke people's accounts, and open or close registering with
  the office password (invites work either way). Works while the office runs.

agent-office tunnel [office@address | url] [--port <n>] [--office-port <n>] [--name <name>] [--password <pw>] [--no-open] [--insecure] [-- <ssh options>]

  On your own computer, for an office that runs somewhere else: every web server
  a worker starts there opens on the same port here, by itself, and closes when
  the worker stops it. Given an SSH address it opens the tunnel to the office too.
  See docs/tunnel.md.
```
