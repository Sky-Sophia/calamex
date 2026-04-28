import AiPromptInput from '@/components/business/ai/AiPromptInput.vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

describe('AiPromptInput', () => {
    it('emits pasted image files as attachments', async () => {
        const wrapper = mount(AiPromptInput, {
            props: {
                modelValue: '',
                disabled: false,
                errorMessage: '',
                submitLabel: '发送',
                attachments: [],
                hasAttachments: false,
                'onUpdate:modelValue': () => undefined,
            },
        });

        const file = new File(['image-bytes'], 'pasted-image.png', { type: 'image/png' });
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
            value: {
                items: [
                    {
                        kind: 'file',
                        type: 'image/png',
                        getAsFile: () => file,
                    },
                ],
            },
        });

        wrapper.get('textarea').element.dispatchEvent(event);
        await nextTick();

        expect(event.defaultPrevented).toBe(true);
        expect(wrapper.emitted('fileSelected')).toHaveLength(1);
        expect(wrapper.emitted('fileSelected')?.[0]?.[0]).toBe(file);
    });

    it('hides image metadata inside attachment chips', () => {
        const wrapper = mount(AiPromptInput, {
            props: {
                modelValue: '',
                disabled: false,
                errorMessage: '',
                submitLabel: '发送',
                attachments: [
                    {
                        id: 'image-1',
                        name: 'pasted-image.png',
                        kind: 'image',
                        sizeLabel: '4.5 KB',
                        detailLabel: '665 × 329',
                    },
                ],
                hasAttachments: true,
                'onUpdate:modelValue': () => undefined,
            },
        });

        expect(wrapper.text()).toContain('pasted-image.png');
        expect(wrapper.text()).not.toContain('665 × 329');
        expect(wrapper.text()).not.toContain('4.5 KB');
    });
});