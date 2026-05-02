import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentStreamEventBus } from './stream-event-bus.js';
import { normalizeStrandsStreamEvent } from './stream-normalizer.js';
import { redactForStream } from './stream-redaction.js';

describe('streaming event layer', () => {
  it('normalizes model text delta without forwarding reasoning payloads', () => {
    const drafts = normalizeStrandsStreamEvent({
      type: 'modelStreamUpdateEvent',
      event: {
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'textDelta',
          text: 'hello',
        },
      },
    });

    assert.deepEqual(drafts, [{
      type: 'agent.text.delta',
      visibility: 'debug',
      level: 'debug',
      text: 'hello',
    }]);
    assert.deepEqual(normalizeStrandsStreamEvent({
      type: 'modelStreamUpdateEvent',
      event: {
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'reasoningText',
          text: 'hidden reasoning',
        },
      },
    }), []);
  });

  it('normalizes tool lifecycle events with redacted previews', () => {
    const started = normalizeStrandsStreamEvent({
      type: 'beforeToolCallEvent',
      toolUse: {
        name: 'mcp.fs.read_file',
        toolUseId: 'tool-1',
        input: {
          path: 'src/app.ts',
          apiKey: 'secret-value',
        },
      },
    });
    const completed = normalizeStrandsStreamEvent({
      type: 'afterToolCallEvent',
      toolUse: {
        name: 'mcp.fs.read_file',
        toolUseId: 'tool-1',
        input: {},
      },
      result: {
        status: 'success',
        content: [{
          type: 'textBlock',
          text: 'done',
        }],
      },
    });
    const startedEvent = started[0];
    const completedEvent = completed[0];

    assert.equal(startedEvent?.type, 'agent.tool.started');
    if (!startedEvent || startedEvent.type !== 'agent.tool.started') {
      throw new Error('tool started event was not normalized');
    }
    assert.match(startedEvent.inputPreview ?? '', /\[REDACTED_SECRET\]/u);
    assert.equal(completedEvent?.type, 'agent.tool.completed');
    if (!completedEvent || completedEvent.type !== 'agent.tool.completed') {
      throw new Error('tool completed event was not normalized');
    }
    assert.equal(completedEvent.ok, true);
  });

  it('handles unavailable projected input tokens explicitly', () => {
    const drafts = normalizeStrandsStreamEvent({
      type: 'beforeModelCallEvent',
    });

    const event = drafts[0];

    assert.equal(event?.type, 'agent.model.started');
    if (!event || event.type !== 'agent.model.started') {
      throw new Error('model started event was not normalized');
    }
    assert.equal(event.projectedInputTokensAvailable, false);
    assert.equal('projectedInputTokens' in (drafts[0] ?? {}), false);
  });

  it('redacts common secret shapes before events leave the sidecar', () => {
    const input = [
      'Authorization: Bearer abc.def',
      'password="plain-text"',
      'Cookie: sid=123',
      '-----BEGIN PRIVATE KEY-----',
      'abc',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const redacted = redactForStream(input);

    assert.doesNotMatch(redacted, /abc\.def/u);
    assert.doesNotMatch(redacted, /plain-text/u);
    assert.doesNotMatch(redacted, /sid=123/u);
    assert.match(redacted, /\[REDACTED_PRIVATE_KEY\]/u);
  });

  it('assigns stable runtime metadata in emission order', () => {
    const bus = new AgentStreamEventBus({
      runId: 'run-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
      now: () => '2026-05-02T00:00:00.000Z',
    });
    const events = [
      bus.emitDraft({
        type: 'agent.run.started',
        visibility: 'user',
        level: 'info',
        inputPreview: 'start',
      }),
      bus.emitDraft({
        type: 'agent.run.completed',
        visibility: 'user',
        level: 'info',
      }),
    ];

    assert.equal(events[0]?.seq, 0);
    assert.equal(events[1]?.seq, 1);
    assert.equal(events[0]?.schemaVersion, 1);
    assert.equal(events[0]?.redacted, true);
  });
});
