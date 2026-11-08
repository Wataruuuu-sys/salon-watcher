import { describe, expect, it } from 'vitest';
import {
  BEDROCK_CLIENT_OPTIONS,
  CLASSIFY_TOOL,
  DEFAULT_CLASSIFY_MODEL_ID,
  bedrockClassifier,
  buildUserContent,
  type MessagesClient,
} from '../../src/classify/llm';
import { TAMA_CITIES } from '../../src/config/areas';

type CreateParams = Parameters<MessagesClient['messages']['create']>[0];

/** Records each request and answers with the given content blocks. */
function stubClient(content: unknown[]): { client: MessagesClient; requests: CreateParams[] } {
  const requests: CreateParams[] = [];
  const client = {
    messages: {
      async create(body: CreateParams) {
        requests.push(body);
        return { content };
      },
    },
  } as unknown as MessagesClient;
  return { client, requests };
}

const INPUT = { text: '立川にネイルサロンをオープン', authorHandle: 'threads:a', postedAt: null };

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
    expect(BEDROCK_CLIENT_OPTIONS).toEqual({ timeout: 30_000, maxRetries: 2 });
  });
});

describe('bedrockClassifier', () => {
  const toolUse = {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'record_classification',
    input: {
      verdict: 'yes',
      storeName: 'Nail Lily',
      genre: 'nail',
      city: '立川市',
      openingDate: '2026-11-01',
      reason: '開業告知',
      signals: [],
    },
  };

  it('defaults to Claude Haiku 5.5 on Bedrock', () => {
    expect(DEFAULT_CLASSIFY_MODEL_ID).toBe('anthropic.claude-haiku-5-5');
  });

  it('is the real (bedrock) classifier', () => {
    expect(bedrockClassifier({ modelId: 'm', client: stubClient([toolUse]).client }).kind).toBe('bedrock');
  });

  it('calls the configured model with the classification tool forced', async () => {
    const { client, requests } = stubClient([toolUse]);
    await bedrockClassifier({ modelId: 'jp.anthropic.claude-haiku-5-5', client }).classify(INPUT);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: 'jp.anthropic.claude-haiku-5-5',
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: 'tool', name: 'record_classification' },
    });
    expect(JSON.stringify(requests[0]!.messages)).toContain('立川にネイルサロンをオープン');
  });

  it('parses the tool_use block into a Classification', async () => {
    const { client } = stubClient([{ type: 'text', text: '' }, toolUse]);
    expect(await bedrockClassifier({ modelId: 'm', client }).classify(INPUT)).toEqual({
      verdict: 'yes',
      storeName: 'Nail Lily',
      genre: 'nail',
      city: '立川市',
      openingDate: '2026-11-01',
      reason: '開業告知',
      signals: [],
    });
  });

  it('throws when the response has no tool call, so the caller retries', async () => {
    const { client } = stubClient([{ type: 'text', text: 'maybe' }]);
    await expect(bedrockClassifier({ modelId: 'm', client }).classify(INPUT)).rejects.toThrow(/no tool_use/);
  });
});
