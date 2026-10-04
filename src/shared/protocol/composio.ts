// The Composio integrations: Linear, Notion, Slack, Google Calendar and Gmail as stations in the
// office, each person connecting their own accounts (see src/server/composio.ts).

/** The toolkits the office knows how to show, by Composio's slug for each. */
export const COMPOSIO_TOOLKITS = ['linear', 'notion', 'slack', 'googlecalendar', 'gmail'] as const;
export type ComposioToolkit = (typeof COMPOSIO_TOOLKITS)[number];

export const COMPOSIO_TOOLKIT_META: Readonly<Record<ComposioToolkit, { label: string; icon: string; station: string }>> = {
  linear: { label: 'Linear', icon: '📐', station: 'Linear board' },
  notion: { label: 'Notion', icon: '📓', station: 'Notion bookshelf' },
  slack: { label: 'Slack', icon: '💬', station: 'Slack TV' },
  googlecalendar: { label: 'Google Calendar', icon: '📅', station: 'Calendar' },
  gmail: { label: 'Gmail', icon: '✉️', station: 'Mailroom' },
};

export function isComposioToolkit(x: unknown): x is ComposioToolkit {
  return typeof x === 'string' && (COMPOSIO_TOOLKITS as readonly string[]).includes(x);
}

/**
 * What everyone sees of the office's Composio setup. Never the API key itself: just whether one is
 * set, who set it, and which toolkits are switched on.
 */
export interface ComposioState {
  /** An API key is set (from setup, --composio-key, or ⚙️ Settings). */
  configured: boolean;
  /** The SDK could be loaded on this machine (it needs Node 22.22+). */
  available: boolean;
  /** The toolkits admins switched on; a station is only built for these. */
  toolkits: ComposioToolkit[];
  by?: string;
  at?: number;
  /** Why the last check of the key failed, if it did. */
  error?: string;
}

export type ComposioConnection = 'connected' | 'pending' | 'off';

/** One person's own connections, sent only to them. */
export interface ComposioConnections {
  toolkits: Partial<Record<ComposioToolkit, ComposioConnection>>;
  /** When they can't connect: on the shared password with no account, or the office has no key. */
  blocked?: string;
}

export type ComposioClientMsg =
  /** Asks for the office's state and your own connections. */
  | { t: 'composio.get' }
  /** Admins: set (or '' to remove) the office's Composio API key. */
  | { t: 'composio.key'; apiKey: string }
  /** Admins: which toolkits the office shows. */
  | { t: 'composio.toolkits'; toolkits: ComposioToolkit[] };

export type ComposioServerMsg =
  | { t: 'composio'; state: ComposioState }
  | { t: 'composio.connections'; connections: ComposioConnections }
  /** Someone on this floor did something through a station: a line floats over their head. */
  | { t: 'composio:activity'; user: string; peer?: string; toolkit: ComposioToolkit; summary: string };
