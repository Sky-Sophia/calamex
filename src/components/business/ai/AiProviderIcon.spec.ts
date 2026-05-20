import AiProviderIcon from '@/components/business/ai/AiProviderIcon.vue';
import { findAiProviderIconDefinition } from '@/constants/ai-provider-icons';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

describe('AiProviderIcon', () => {
  it('renders all configured service platform icons without crashing', () => {
    const platformIds = [
      'openai',
      'anthropic',
      'deepseek',
      'google',
      'moonshotai',
      'alibaba',
      'zhipuai',
      'ollama',
    ] as const;

    for (const platformId of platformIds) {
      const wrapper = mount(AiProviderIcon, {
        props: {
          platformId,
        },
      });

      expect(wrapper.get('.ai-provider-icon').exists()).toBe(true);
      expect(wrapper.find('img').exists() || wrapper.find('.ai-provider-icon__fallback').exists()).toBeTruthy();
    }
  });

  it('falls back to a safe icon definition when platform data is unexpected', () => {
    const iconDefinition = findAiProviderIconDefinition('unknown-platform');

    expect(iconDefinition.label).toBe('未知平台');
    expect(iconDefinition.iconUrl).toBeNull();
    expect(iconDefinition.background).toBeTruthy();
  });
});
