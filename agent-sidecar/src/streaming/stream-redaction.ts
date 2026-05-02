const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/giu,
    'Authorization: Bearer [REDACTED_SECRET]',
  ],
  [
    /Bearer\s+[A-Za-z0-9._-]+/giu,
    'Bearer [REDACTED_SECRET]',
  ],
  [
    /(["']?(?:api[_-]?key|apiKey|token|password|secret)["']?\s*[:=]\s*)["']?[^"'\s,}]+/giu,
    '$1[REDACTED_SECRET]',
  ],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
    '[REDACTED_PRIVATE_KEY]',
  ],
  [
    /Cookie:\s*[^\n\r]+/giu,
    'Cookie: [REDACTED_COOKIE]',
  ],
];

export const redactForStream = (input: string): string => {
  let output = input;

  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }

  return output;
};
