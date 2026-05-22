import AiProviderSettings from '@/components/business/ai/provider/AiProviderSettings.vue';
import type { IAiConfigPayload, IAiProviderSettingsActionFeedback } from '@/types/ai';
import { createDefaultAiModelEndpointConfig } from '@/services/ipc/ai-config.service';
import { mount, type DOMWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

const createGlobalMountOptions = () => ({
  global: {
    stubs: {
      teleport: true,
    },
  },
});

const createConfig = (overrides: Partial<IAiConfigPayload> = {}): IAiConfigPayload => ({
  providerType: 'mastra',
  selectedModel: 'openai/gpt-5.5',
  baseUrl: null,
  isBaseUrlConfigured: false,
  hasCredentials: true,
  isConfigured: true,
  inlineCompletionEnabled: false,
  chatEnabled: true,
  agentEnabled: false,
  narrator: createDefaultAiModelEndpointConfig('zhipuai/glm-4.7-flash'),
  credentials: [
    {
      providerId: 'openai',
      hasCredentials: true,
      alias: '个人',
      keyPreview: 'sk-ab…7Qd2',
    },
    {
      providerId: 'deepseek',
      hasCredentials: false,
      alias: '默认',
      keyPreview: '',
    },
    {
      providerId: 'zhipuai',
      hasCredentials: true,
      alias: '默认',
      keyPreview: 'sk-gl…9Wz1',
    },
  ],
  ...overrides,
});

const mountSettings = (props: Partial<{
  open: boolean;
  config: IAiConfigPayload;
  draft: IAiConfigPayload;
  apiKey: string;
  tavilyApiKey: string;
}> = {}) => {
  const config = props.config ?? createConfig();

  return mount(AiProviderSettings, {
    props: {
      open: true,
      config,
      draft: props.draft ?? config,
      apiKey: props.apiKey ?? '',
      tavilyApiKey: props.tavilyApiKey ?? '',
      ...props,
    },
    ...createGlobalMountOptions(),
  });
};

const findButtonByText = (buttons: DOMWrapper<Element>[], label: string): DOMWrapper<Element> => {
  const button = buttons.find((item) => item.text().includes(label));

  if (!button) {
    throw new Error(`未找到按钮：${label}`);
  }

  return button;
};

const openProviderForm = async (
  wrapper: ReturnType<typeof mountSettings>,
  providerLabel: string,
): Promise<void> => {
  const trigger = wrapper.find(`[aria-label*="${providerLabel} 凭证"]`);
  if (!trigger.exists()) {
    throw new Error(`未找到厂商入口：${providerLabel}`);
  }
  await trigger.trigger('click');
};

const openAddForm = async (wrapper: ReturnType<typeof mountSettings>): Promise<void> => {
  await findButtonByText(wrapper.findAll('button'), '添加').trigger('click');
};

const selectProviderInForm = async (
  wrapper: ReturnType<typeof mountSettings>,
  providerLabel: string,
): Promise<void> => {
  await wrapper.get('#ai-provider-select').trigger('click');
  await findButtonByText(wrapper.findAll('button'), providerLabel).trigger('click');
};

const getFeedback = (event: unknown[] | undefined): IAiProviderSettingsActionFeedback => {
  if (!event) {
    throw new Error('未找到事件');
  }

  return event.at(-1) as IAiProviderSettingsActionFeedback;
};

describe('AiProviderSettings', () => {
  it('按厂商展示凭证状态，不再渲染配置记录入口', () => {
    const wrapper = mountSettings();

    expect(wrapper.text()).toContain('AI 凭证');
    expect(wrapper.text()).toContain('OpenAI');
    expect(wrapper.text()).toContain('个人');
    expect(wrapper.text()).toContain('openai / sk-ab…7Qd2');
    expect(wrapper.text()).not.toContain('DeepSeek');
    expect(wrapper.text()).not.toContain('等待配置');
    expect(wrapper.text()).not.toContain('默认模型');
    expect(wrapper.text()).not.toContain('该厂商已有本地凭证');
    expect(wrapper.text()).not.toContain('个模型');
    expect(wrapper.text()).not.toContain('AI 配置记录');
    expect(wrapper.findAll('[aria-label="默认小模型厂商"]')).toHaveLength(1);
    expect(wrapper.find('[aria-label="进入配置记录"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label*="删除"]').exists()).toBe(false);
  });

  it('保存厂商 API Key 时只提交厂商 ID 和 Key', async () => {
    const wrapper = mountSettings();

    await openAddForm(wrapper);
    await selectProviderInForm(wrapper, 'DeepSeek');
    await wrapper.get('#ai-credential-alias').setValue('工作');
    await wrapper.get('#ai-provider-key').setValue('sk-deepseek-test');
    await wrapper.setProps({ apiKey: 'sk-deepseek-test' });
    await findButtonByText(wrapper.get('.ai-credential-foot').findAll('button'), '保存').trigger('click');

    const event = wrapper.emitted('saveCredentials')?.[0];
    expect(event?.[0]).toBe('sk-deepseek-test');
    expect(event?.[1]).toBe('deepseek');
    expect(event?.[2]).toBe('工作');

    getFeedback(event).onSuccess('DeepSeek API Key 已保存');
    await nextTick();
    expect(wrapper.text()).toContain('DeepSeek API Key 已保存');
  });

  it('测试主模型时按主模型厂商走真实连接事件', async () => {
    const wrapper = mountSettings();

    await openProviderForm(wrapper, 'OpenAI');
    await findButtonByText(wrapper.findAll('button'), '测试').trigger('click');

    const event = wrapper.emitted('testProvider')?.[0];
    expect(event?.[2]).toBe('main');
    expect(event?.[0]).toMatchObject({
      providerType: 'mastra',
      selectedModel: 'openai/gpt-5.5',
    });
  });

  it('测试小模型不改动主模型配置', async () => {
    const draft = createConfig({
      selectedModel: 'openai/gpt-5.5',
      narrator: {
        ...createDefaultAiModelEndpointConfig('deepseek/deepseek-v4-pro'),
        hasCredentials: false,
        isConfigured: false,
      },
      credentials: [{
        providerId: 'deepseek',
        hasCredentials: true,
        alias: '默认',
        keyPreview: 'sk-ds…1234',
      }],
    });
    const wrapper = mountSettings({ config: draft, draft });

    await openProviderForm(wrapper, 'DeepSeek');
    await findButtonByText(wrapper.findAll('button'), '测试').trigger('click');

    const event = wrapper.emitted('testProvider')?.[0];
    expect(event?.[2]).toBe('narrator');
    const emittedConfig = event?.[0] as IAiConfigPayload;
    expect(emittedConfig.selectedModel).toBe('openai/gpt-5.5');
    expect(emittedConfig.narrator.selectedModel).toBe('deepseek/deepseek-v4-pro');
  });

  it('在凭证列表设置主模型默认时只保存主模型配置', async () => {
    const wrapper = mountSettings();

    await wrapper.get('[aria-label="设为主模型：智谱 GLM"]').trigger('click');

    const event = wrapper.emitted('save')?.[0];
    expect(event?.[1]).toBe('');
    expect(event?.[2]).toBe('main');
    const emittedConfig = event?.[0] as IAiConfigPayload;
    expect(emittedConfig.selectedModel).toBe('zhipuai/glm-4.7-flash');
    expect(emittedConfig.narrator.selectedModel).toBe('zhipuai/glm-4.7-flash');
  });

  it('在凭证列表设置小模型默认时不改动主模型配置', async () => {
    const wrapper = mountSettings();

    await wrapper.get('[aria-label="设为小模型：OpenAI"]').trigger('click');

    const event = wrapper.emitted('save')?.[0];
    expect(event?.[1]).toBe('');
    expect(event?.[2]).toBe('narrator');
    const emittedConfig = event?.[0] as IAiConfigPayload;
    expect(emittedConfig.selectedModel).toBe('openai/gpt-5.5');
    expect(emittedConfig.narrator.selectedModel).toBe('openai/gpt-5.5');
  });

  it('表单里的小模型默认模型随厂商切换，并按所选模型保存小模型', async () => {
    const config = createConfig({
      credentials: [
        {
          providerId: 'deepseek',
          hasCredentials: true,
          alias: '默认',
          keyPreview: 'sk-ds…1234',
        },
      ],
    });
    const wrapper = mountSettings({ config, draft: config });

    await openProviderForm(wrapper, 'DeepSeek');
    expect(wrapper.get('[data-small-model-select]').text()).toContain('DeepSeek-v4-pro');

    await wrapper.get('[data-small-model-select]').trigger('click');
    await findButtonByText(wrapper.findAll('.ai-credential-combobox-option'), 'DeepSeek-v4-flash')
      .trigger('click');
    expect(wrapper.find('[aria-label="设为小模型"]').exists()).toBe(false);
    await findButtonByText(wrapper.get('.ai-credential-foot').findAll('button'), '保存').trigger('click');

    const event = wrapper.emitted('save')?.[0];
    expect(event?.[1]).toBe('');
    expect(event?.[2]).toBe('narrator');
    const emittedConfig = event?.[0] as IAiConfigPayload;
    expect(emittedConfig.selectedModel).toBe('openai/gpt-5.5');
    expect(emittedConfig.narrator.selectedModel).toBe('deepseek/deepseek-v4-flash');
  });

  it('保存 Tavily Key 走独立事件', async () => {
    const wrapper = mountSettings();

    await openProviderForm(wrapper, 'OpenAI');
    await wrapper.get('[data-tavily-input]').setValue('tvly-test-key');
    await wrapper.setProps({ tavilyApiKey: 'tvly-test-key' });
    await wrapper.get('[data-save-tavily]').trigger('click');

    expect(wrapper.emitted('saveTavilyKey')?.[0]?.[0]).toBe('tvly-test-key');
  });

  it('点击遮罩关闭，点击弹窗本身不关闭', async () => {
    const wrapper = mountSettings();

    await wrapper.get('.ai-credential-dialog').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();

    await wrapper.get('.ai-credential-shell').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
