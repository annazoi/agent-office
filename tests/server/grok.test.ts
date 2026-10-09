import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGrokHook,
  validateGrokHook,
  withoutGrokLaunchArgs,
} from '../../src/server/agents/grok.js';

test('normalizes bounded root Grok hook payloads from camelCase or snake_case', () => {
  assert.deepEqual(normalizeGrokHook('SessionStart', {
    sessionId: 'sess-1', source: 'startup', toolInput: { command: 'secret' },
  }), { sessionId: 'sess-1', event: 'SessionStart', source: 'startup' });
  assert.deepEqual(normalizeGrokHook('UserPromptSubmit', {
    session_id: 'sess-1', prompt: '  fix the login  ', model: 'secret-model',
  }), { sessionId: 'sess-1', event: 'UserPromptSubmit', prompt: 'fix the login' });
  assert.deepEqual(normalizeGrokHook('PreToolUse', {
    sessionId: 'sess-1', toolName: 'run_terminal_command', toolUseId: 'tool-1',
  }), { sessionId: 'sess-1', event: 'PreToolUse', tool: 'run_terminal_command', toolUseId: 'tool-1' });
  assert.deepEqual(normalizeGrokHook('Notification', {
    sessionId: 'sess-1', notificationType: 'permission_prompt',
  }), { sessionId: 'sess-1', event: 'Notification', notificationType: 'permission_prompt' });
});

test('rejects unknown, malformed, empty, oversized, and child-scoped Grok events', () => {
  assert.equal(validateGrokHook('Unknown', { sessionId: 'x' }), false);
  assert.equal(validateGrokHook('Stop', null), false);
  assert.equal(validateGrokHook('Stop', { sessionId: '' }), false);
  assert.equal(validateGrokHook('Stop', { sessionId: 'x'.repeat(161) }), false);
  assert.equal(validateGrokHook('Stop', { sessionId: 'x', subagentType: 'explore' }), false);
  assert.equal(validateGrokHook('Stop', { sessionId: 'x', agent_id: 'child-1' }), false);
});

test('strips launch flags the office always sets itself', () => {
  assert.deepEqual(
    withoutGrokLaunchArgs(['--keep', 'yes', '--model', 'old', '--no-alt-screen', '--trust', '--session-id', 'abc', '--effort', 'high']),
    ['--keep', 'yes'],
  );
});

