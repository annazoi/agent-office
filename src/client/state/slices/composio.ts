import type { ComposioConnections, ComposioState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The office's Composio setup (never the key), and your own connections to its toolkits. */
    composio: { office: ComposioState; mine: ComposioConnections };
  }
  interface Topics {
    composio: true;
  }
}

export const composio: Slice = {
  init(s) {
    s.composio = { office: { configured: false, available: true, toolkits: [] }, mine: { toolkits: {} } };
  },
  on: {
    composio(s, m) {
      s.composio = { ...s.composio, office: m.state };
      return ['composio'];
    },
    'composio.connections'(s, m) {
      s.composio = { ...s.composio, mine: m.connections };
      return ['composio'];
    },
  },
};
