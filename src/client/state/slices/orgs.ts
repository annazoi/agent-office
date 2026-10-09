import type { OrgsState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Your organisations and the one you're working in; null until the office sends them. */
    orgs: OrgsState | null;
  }
  interface Topics {
    orgs: true;
  }
}

export const orgs: Slice = {
  init(s) {
    s.orgs = null;
  },
  on: {
    orgs(s, m) {
      s.orgs = m.state;
      return ['orgs'];
    },
  },
};
