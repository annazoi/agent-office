// Composio's tools for the workers: each agent CLI gets the hiring account's own Composio MCP
// endpoint (see ComposioHub.mcpFor) the same way it gets the office's agent-office server
// (office-workers.ts), as a second MCP server called "composio". The endpoint's header carries a
// credential, so it never goes on a command line: Claude and Codex read it from an environment
// variable they're told the name of (Claude expands ${…} in its --mcp-config), and OpenCode from its config in
// the environment. Nothing here runs unless the office has a Composio key and the account connected
// something, so a worker without it starts exactly as before.
import type { ComposioToolkit } from '../../shared/protocol.js';

export const COMPOSIO_MCP_NAME = 'composio';
/** The environment variable a Codex worker reads the endpoint's header from (see codexComposioMcpArgs). */
export const COMPOSIO_HEADER_ENV = 'AGENT_OFFICE_COMPOSIO_MCP_HEADER';

/** A worker's Composio endpoint: where, and what to send with it. */
export interface ComposioMcp {
  type: 'http' | 'sse';
  url: string;
  headers: Record<string, string>;
}

/** Looks up the endpoint for an account, from what the hub has already made (never over the network: launch is synchronous). */
export interface ComposioForWorkers {
  mcpCached(owner: string): ComposioMcp | undefined;
}

/**
 * Claude Code: its --mcp-config as JSON for the command line, each header's value only named there
 * (${AGENT_OFFICE_COMPOSIO_MCP_HEADER_<n>}, which Claude expands) and given in the environment.
 */
export function claudeComposioMcp(mcp: ComposioMcp): { config: string; env: Record<string, string> } {
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  Object.entries(mcp.headers).forEach(([name, value], i) => {
    const key = `${COMPOSIO_HEADER_ENV}_${i}`;
    env[key] = value;
    headers[name] = `\${${key}}`;
  });
  return { config: JSON.stringify({ mcpServers: { [COMPOSIO_MCP_NAME]: { type: mcp.type, url: mcp.url, headers } } }), env };
}

/**
 * Codex: `-c` overrides for a streamable-HTTP server, with the header's value in the environment
 * (`env_http_headers` names the variable, so the secret stays out of `ps`). Returns the arguments
 * and the environment to go with them.
 */
export function codexComposioMcp(mcp: ComposioMcp): { args: string[]; env: Record<string, string> } {
  const key = `mcp_servers.${COMPOSIO_MCP_NAME}`;
  const names = Object.keys(mcp.headers);
  const args = ['-c', `${key}.url=${JSON.stringify(mcp.url)}`];
  const env: Record<string, string> = {};
  if (names.length) {
    // One variable per header, named after the first; a TOML inline table maps header → variable.
    const table = names.map((h, i) => `${JSON.stringify(h)} = ${JSON.stringify(i ? `${COMPOSIO_HEADER_ENV}_${i}` : COMPOSIO_HEADER_ENV)}`).join(', ');
    args.push('-c', `${key}.env_http_headers={ ${table} }`);
    names.forEach((h, i) => (env[i ? `${COMPOSIO_HEADER_ENV}_${i}` : COMPOSIO_HEADER_ENV] = mcp.headers[h]));
  }
  return { args, env };
}

/** OpenCode: the `mcp` entry merged into OPENCODE_CONFIG_CONTENT (see opencode.ts), a remote server. */
export function openCodeComposioMcp(mcp: ComposioMcp): Record<string, unknown> {
  return { [COMPOSIO_MCP_NAME]: { type: 'remote', url: mcp.url, headers: mcp.headers, enabled: true } };
}

/**
 * What a worker is doing with a Composio tool, in the office's words, for the card over its desk:
 * "Creating Linear issue…" for mcp__composio__LINEAR_CREATE_LINEAR_ISSUE. Undefined for any other tool.
 */
export function describeComposioTool(tool: unknown): string | undefined {
  if (typeof tool !== 'string') return undefined;
  const m = /^mcp__composio__([A-Z0-9]+?)_(.+)$/i.exec(tool.trim());
  if (!m) return undefined;
  const toolkit = TOOLKIT_NAMES[m[1].toLowerCase()] ?? m[1];
  const words = m[2].toLowerCase().split('_');
  const verb = VERBS[words[0]];
  const rest = words.slice(1).filter((w) => w !== m[1].toLowerCase() && w !== 'notion' && w !== 'linear');
  const what = rest.join(' ');
  return verb ? `${verb} ${toolkit} ${what}…`.replace(/\s+/g, ' ') : `${toolkit}: ${words.join(' ')}…`;
}

const TOOLKIT_NAMES: Record<string, string> = { linear: 'Linear', notion: 'Notion', slack: 'Slack', googlecalendar: 'Calendar', gmail: 'Gmail', github: 'GitHub' } satisfies Record<ComposioToolkit, string>;
const VERBS: Record<string, string> = {
  create: 'Creating',
  update: 'Updating',
  list: 'Listing',
  search: 'Searching',
  find: 'Finding',
  fetch: 'Reading',
  get: 'Reading',
  retrieve: 'Reading',
  send: 'Sending',
  reply: 'Replying to',
  delete: 'Deleting',
  add: 'Adding',
  move: 'Moving',
  archive: 'Archiving',
  query: 'Querying',
  events: 'Listing',
};
