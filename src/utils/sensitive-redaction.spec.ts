import { describe, expect, it } from 'vitest';

import { redactForLog, redactSensitiveText } from './sensitive-redaction';

describe('sensitive-redaction', () => {
  it('redacts apiKey fields recursively without dropping shape', () => {
    const redacted = redactForLog({
      providerType: 'openai',
      nested: {
        api_key: 'sk-test-secret-value',
      },
      list: [{ authorization: 'Bearer token-value-1234567890' }],
    });

    const serialized = JSON.stringify(redacted);

    expect(serialized).toContain('"providerType":"openai"');
    expect(serialized).toContain('"redacted":true');
    expect(serialized).not.toContain('sk-test-secret-value');
    expect(serialized).not.toContain('token-value-1234567890');
  });

  it('redacts secret-looking strings in error messages', () => {
    const message = redactSensitiveText(
      'Authorization: Bearer token-value-1234567890 api_key=sk-test-secret-value',
    );

    expect(message).toContain('Authorization: [REDACTED]');
    expect(message).toContain('api_key: [REDACTED]');
    expect(message).not.toContain('token-value-1234567890');
    expect(message).not.toContain('sk-test-secret-value');
  });
});
