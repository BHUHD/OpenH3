import { describe, expect, it } from 'vitest';

describe('media job event contract', () => {
  it('uses SSE progress events with a complete job payload', () => {
    const payload = { id: 'job-1', status: 'running', progress: 0.5 };
    const encoded = `event: progress\ndata: ${JSON.stringify(payload)}\n\n`;
    expect(encoded).toContain('event: progress');
    expect(JSON.parse(encoded.split('data: ')[1].trim())).toEqual(payload);
  });
});
