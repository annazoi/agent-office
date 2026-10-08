/** Credentials the office's own environment may carry. None of them reach anything run as someone else. */
export const CLAUDE_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'];
export const GITHUB_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'GIT_CONFIG_GLOBAL'];
/** GitHub's one-time codes last 15 minutes; a Claude sign-in link gets as long. */
export const FLOW_MS = 15 * 60_000;
/** Someone's sign-ins are looked at again at most this often, unless they ask. */
export const LOOK_GAP_MS = 20_000;
export const LOOK_TIMEOUT_MS = 30_000;
/** From `claude setup-token` (sk-ant-oat01-…), or an Anthropic API key (sk-ant-api03-…). */
export const CLAUDE_TOKEN = /^sk-ant-[a-z]+\d*-[A-Za-z0-9_-]{20,}$/;
export const API_KEY = /^sk-ant-api/;
/** ghp_…, github_pat_…, gho_… and the like. */
export const GITHUB_TOKEN = /^[A-Za-z0-9_]{20,255}$/;
export const ACCOUNT_ID = /^[A-Za-z0-9]{6,64}$/;
export const HELP_WHERE = '☰ → 🔐 Your sign-ins';
