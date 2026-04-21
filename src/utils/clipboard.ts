const createFallbackTextarea = (value: string): HTMLTextAreaElement => {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.inset = '0';
  return textarea;
};

export const writeClipboardText = async (value: string): Promise<void> => {
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('当前环境不支持剪贴板写入');
  }

  const textarea = createFallbackTextarea(value);
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('当前环境不支持剪贴板写入');
  }
};

export const tryWriteClipboardText = async (value: string): Promise<boolean> => {
  try {
    await writeClipboardText(value);
    return true;
  } catch {
    return false;
  }
};
