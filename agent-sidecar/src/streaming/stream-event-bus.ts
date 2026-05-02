import { EventEmitter } from 'node:events';

import {
  createAgentRuntimeEvent,
  type IAgentRuntimeEventContext,
  type TAgentRuntimeEvent,
  type TAgentRuntimeEventDraft,
} from './stream-types.js';

export class AgentStreamEventBus {
  private readonly emitter = new EventEmitter();

  private seq = 0;

  constructor(private readonly context: IAgentRuntimeEventContext) {}

  emitDraft(draft: TAgentRuntimeEventDraft): TAgentRuntimeEvent {
    const event = createAgentRuntimeEvent(this.context, this.seq, draft);
    this.seq += 1;
    this.emitEvent(event);
    return event;
  }

  emitEvent(event: TAgentRuntimeEvent): void {
    this.emitter.emit('event', event);
  }

  onEvent(listener: (event: TAgentRuntimeEvent) => void): () => void {
    this.emitter.on('event', listener);

    return () => {
      this.emitter.off('event', listener);
    };
  }
}
