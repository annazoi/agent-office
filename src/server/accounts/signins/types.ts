import type { SignInKind, SignInState } from '../../../shared/protocol.js';

export interface Saved {
  /** Unset: its own login, in its folder. A token pasted from `claude setup-token` (or an API key). The office machine's own (admins). */
  claude?: { use: 'token'; token: string } | { use: 'office' };
  github?: { use: 'office' };
  /** Who the last look found each signed in as, so workers can start before the next look. */
  seen?: { claude?: string; github?: string };
}

/** A sign-in the office is running for someone. */
export interface Flow {
  stop(): void;
  /** Types into it: the code from Claude's sign-in page. */
  write?(data: string): void;
}

export interface Live {
  claude: Omit<SignInState, 'how'>;
  github: Omit<SignInState, 'how'>;
  flows: Partial<Record<SignInKind, Flow>>;
  looking?: Promise<void>;
  lookedAt: number;
}

/** Whose gh the office runs for someone: their own sign-in's environment (`key` tells logins apart). */
export interface GhAs {
  key: string;
  env: Record<string, string>;
}
