import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMuseHook,
  validateMuseHook,
  withoutMuseLaunchArgs,
} from '../../src/server/agents/muse.js';

test('normalizes bounded root Muse hook payloads from camelCase or snake_case', () => {
  assert.deepEqual(normalizeMuseHook('SessionStart', {
    session_id: 'sess-1', source: 'startup', last_assistant_message: 'secret',
  }), { sessionId: 'sess-1', event: 'SessionStart', source: 'startup' });
  assert.deepEqual(normalizeMuseHook('', {
    hook_event_name: 'UserPromptSubmit', session_id: 'sess-1', prompt: '  fix the login  ',
  }), { sessionId: 'sess-1', event: 'UserPromptSubmit', prompt: 'fix the login' });
  assert.deepEqual(normalizeMuseHook('PreToolUse', {
    sessionId: 'sess-1', tool_name: 'run_terminal_command', tool_use_id: 'tool-1',
  }), { sessionId: 'sess-1', event: 'PreToolUse', tool: 'run_terminal_command', toolUseId: 'tool-1' });
  assert.deepEqual(normalizeMuseHook('PermissionRequest', {
    session_id: 'sess-1', tool: 'shell',
  }), { sessionId: 'sess-1', event: 'PermissionRequest', tool: 'shell' });
});

test('rejects unknown, malformed, empty, oversized, and child-scoped Muse events', () => {
  assert.equal(validateMuseHook('Unknown', { session_id: 'x' }), false);
  assert.equal(validateMuseHook('Stop', null), false);
  assert.equal(validateMuseHook('Stop', { session_id: '' }), false);
  assert.equal(validateMuseHook('Stop', { session_id: 'x'.repeat(161) }), false);
  assert.equal(validateMuseHook('Stop', { session_id: 'x', subagent_type: 'explore' }), false);
  assert.equal(validateMuseHook('Stop', { session_id: 'x', parent_session_id: 'root' }), false);
});

test('strips launch flags the office always sets itself', () => {
  assert.deepEqual(
    withoutMuseLaunchArgs(['--keep', 'yes', '--model', 'old', '--trust-workspace', '--yolo', '-w', 'resume', 'abc', '--reasoning-effort', 'high', '--', 'prompt']),
    ['--keep', 'yes'],
  );
});

