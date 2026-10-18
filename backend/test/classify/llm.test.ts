import { describe, expect, it } from 'vitest';
import { ANTHROPIC_CLIENT_OPTIONS, CLASSIFY_TOOL, buildUserContent } from '../../src/classify/llm';
import { TAMA_CITIES } from '../../src/config/areas';

describe('llm request shape', () => {
  it('constrains city to the Tama cities or null', () => {
    const props = CLASSIFY_TOOL.input_schema.properties as Record<string, { enum?: unknown[] }>;
    expect(props.city!.enum).toEqual([...TAMA_CITIES, null]);
  });

  it('includes today\'s date (JST) in the user message when now is given', () => {
    const content = buildUserContent({
      text: '本文',
      authorHandle: 'threads:a',
      postedAt: null,
      now: new Date('2026-10-18T16:00:00Z'),
    });
    expect(content).toContain('今日の日付: 2026-10-19');
    expect(content).toContain('本文');
  });

  it('bounds each API call with a timeout and limited retries', () => {
    expect(ANTHROPIC_CLIENT_OPTIONS).toEqual({ timeout: 30_000, maxRetries: 2 });
  });
});
