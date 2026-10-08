import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cursorBlocked,
  normalizeCursorHook,
  withoutCursorLaunchArgs,
} from '../../src/server/agents/cursor.js';
import { isValidCursorModel } from '../../src/shared/agents/providers.js';

test('maps Cursor hook events onto the lifecycle, keeping only bounded root fields', () => {
  assert.deepEqual(normalizeCursorHook('sessionStart', {
    conversation_id: 'chat-1', session_id: 'chat-1', model: 'gpt-5', composer_mode: 'agent', is_background_agent: false, transcript_path: '/secret',
  }), { sessionId: 'chat-1', event: 'SessionStart' });
  assert.deepEqual(normalizeCursorHook('beforeSubmitPrompt', {
    conversation_id: 'chat-1', prompt: '  fix the login  ', attachments: [{ file_path: '/secret' }],
  }), { sessionId: 'chat-1', event: 'UserPromptSubmit', prompt: 'fix the login' });
  assert.deepEqual(normalizeCursorHook('preToolUse', {
    conversation_id: 'chat-1', tool_name: 'Shell', tool_use_id: 'tool-1', tool_input: { command: 'cat .env' }, agent_message: 'private',
  }), { sessionId: 'chat-1', event: 'PreToolUse', tool: 'Shell', toolUseId: 'tool-1' });
  assert.deepEqual(normalizeCursorHook('postToolUse', {
    conversation_id: 'chat-1', tool_name: 'Shell', tool_use_id: 'tool-1', tool_output: 'private',
  }), { sessionId: 'chat-1', event: 'PostToolUse', tool: 'Shell', toolUseId: 'tool-1' });
  assert.deepEqual(normalizeCursorHook('postToolUseFailure', {
    conversation_id: 'chat-1', tool_name: 'Shell', failure_type: 'permission_denied', error_message: 'private',
  }), { sessionId: 'chat-1', event: 'PostToolUseFailure', tool: 'Shell' });
  assert.deepEqual(normalizeCursorHook('stop', { session_id: 'chat-1', status: 'completed', loop_count: 0 }), { sessionId: 'chat-1', event: 'Stop' });
});

test('rejects unknown, malformed, child-scoped and unsafe Cursor events', () => {
  assert.equal(normalizeCursorHook('afterAgentResponse', { conversation_id: 'chat-1', text: 'private' }), undefined);
  assert.equal(normalizeCursorHook('Stop', { conversation_id: 'chat-1' }), undefined);
  assert.equal(normalizeCursorHook('stop', null), undefined);
  assert.equal(normalizeCursorHook('stop', {}), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: '' }), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: 'x'.repeat(129) }), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: 'chat-1', subagent_id: 'child-1' }), undefined);
  assert.equal(normalizeCursorHook('preToolUse', { conversation_id: 'chat-1', parent_conversation_id: 'chat-0' }), undefined);
  assert.equal(normalizeCursorHook('sessionStart', { conversation_id: 'chat-1', is_background_agent: true }), undefined);
  // A chat id goes back on the command line when the worker is resumed: nothing that reads as a flag.
  assert.equal(normalizeCursorHook('sessionStart', { conversation_id: '--force' }), undefined);
  assert.equal(normalizeCursorHook('sessionStart', { conversation_id: 'chat 1' }), undefined);
});

test('strips launch flags the office sets itself and the ones that skip permission prompts', () => {
  assert.deepEqual(
    withoutCursorLaunchArgs(['--keep', 'yes', '--model', 'gpt-5', '--force', '-f', '--yolo', '--trust', '--resume', 'abc', '--continue', '-p', '--output-format', 'json', '--workspace=/x', '-w', '--mode', 'plan']),
    ['--keep', 'yes', '--mode', 'plan'],
  );
  assert.deepEqual(withoutCursorLaunchArgs(['--resume', '--sandbox', 'enabled', '--', 'a prompt']), ['--sandbox', 'enabled']);
});

test('Cursor model ids are checked before they reach the command line', () => {
  for (const ok of ['gpt-5', 'sonnet-4-thinking', 'composer-2.5', 'claude-opus-4-8[context=1m,effort=high,fast=false]']) assert.equal(isValidCursorModel(ok), true, ok);
  for (const bad of ['', '--force', '-m', 'gpt 5', 'gpt-5[effort]', 'gpt-5[effort=high', 'gpt-5]', 'a/b', 'gpt-5;rm', 'gpt\u00005', 'x'.repeat(129), 42, undefined]) {
    assert.equal(isValidCursorModel(bad), false, String(bad));
  }
});

test('reads the login screen off the terminal', () => {
  assert.match(cursorBlocked('  v2026.09.08-6caf4ff\n  Press any key to log in...') ?? '', /signed in/);
  assert.equal(cursorBlocked('→ Add a follow-up'), undefined);
});

