// DeepSeek Harness as a fourth provider, over ACP (see docs/dsh-acp-integration.md).
//
// `dsh` has no interactive terminal: its ACP profile speaks newline-delimited JSON-RPC v1 over
// stdio instead. A DSH worker therefore keeps the office's headless terminal, but nothing is
// mirrored into it — committed assistant messages, thoughts, tool lifecycles and permission
// prompts are rendered into it here, as ANSI lines.
//
// This module owns the wire. The translation core above the connection is pure, so the test suite
// can drive a fake ACP agent over stdio without a DSH install (tests/server/dsh.test.ts).

export { DSH_PROFILE_DEFAULT, DSH_SESSIONS_DIR, DSH_PATCH_FILE, configOptionValues, resolveConfigValue, dshEffort, dshSessionsRoot, dshArgs, writeDshPatch, type DshLaunch } from './dsh/config.js';
export { permissionOptions, permissionChoice, renderPermission, type DshPermissionOption } from './dsh/permission.js';
export { toolKindAction } from './dsh/tools.js';
export { terminalSafe } from './dsh/text.js';
export { dshUsage, DshRenderer, type RenderedUpdate } from './dsh/renderer.js';
export { DshSession, type DshEvents } from './dsh/session.js';
