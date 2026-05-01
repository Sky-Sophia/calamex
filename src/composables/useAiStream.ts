import { computed, ref } from 'vue';

export interface IUseAiStreamOptions {
  messageId?: string;
}

export interface IAiStreamStartOptions {
  messageId?: string;
}

export const useAiStream = (options: IUseAiStreamOptions = {}) => {
  void options;

  const content = ref('');
  const status = ref<'idle' | 'streaming' | 'completed' | 'cancelled'>('idle');

  const start = (startOptions: Readonly<IAiStreamStartOptions> = {}): void => {
    void startOptions;
    content.value = '';
    status.value = 'streaming';
  };

  const append = (chunk: string): void => {
    if (status.value !== 'streaming') {
      return;
    }

    content.value += chunk;
  };

  const complete = (): void => {
    status.value = 'completed';
  };

  const stop = (): void => {
    status.value = 'cancelled';
  };

  return {
    content,
    isStreaming: computed(() => status.value === 'streaming'),
    status: computed(() => status.value),
    start,
    append,
    complete,
    stop,
  };
};
