import Anthropic from '@anthropic-ai/sdk';
import type { Classification, Genre, Verdict } from '../domain/types';
import { TAMA_CITIES } from '../config/areas';
import { GENRES } from '../config/genres';

export interface ClassifyInput {
  text: string;
  authorHandle: string | null;
  postedAt: Date | null;
  /** Current time, so the LLM can apply the "within ~3 months" rule. */
  now?: Date;
}

export interface LlmClassifier {
  classify(input: ClassifyInput): Promise<Classification>;
}

const VERDICTS: Verdict[] = ['yes', 'maybe', 'no'];
const GENRE_IDS: Genre[] = GENRES.map((g) => g.id);

const TOOL_NAME = 'record_classification';

const SYSTEM_PROMPT = `あなたは美容サロンの新規開業情報を判定するアシスタントです。SNS投稿を読み、新店の開業告知かどうかを判定して record_classification ツールで結果を記録してください。

# 対象エリア（東京都多摩地域の26市）
${TAMA_CITIES.join('、')}

# 対象ジャンル（6種）
${GENRES.map((g) => `- ${g.id}: ${g.label}`).join('\n')}

# 「新店」の定義
オープン予定から開業後おおむね3ヶ月までの店舗（「今日の日付」を基準に判断する）。移転オープン・自宅サロンも含む。該当する場合は signals に "relocation"、"home_salon" などを入れる。

# 判定基準
- yes: 開業告知が明確で、対象エリア内と分かり、対象ジャンルである
- maybe: 上記のどれかが不明確
- no: 明らかに対象外（他県、既存店のキャンペーン、美容以外）
迷ったら maybe にする。

city は対象26市のいずれかに該当するときだけその市名を入れ、分からなければ null。openingDate は分かれば YYYY-MM-DD、不明なら null。reason は日本語で簡潔に。`;

export const CLASSIFY_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: 'Record the classification of the SNS post.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: VERDICTS },
      storeName: { type: ['string', 'null'] },
      genre: { type: ['string', 'null'], enum: [...GENRE_IDS, null] },
      city: { type: ['string', 'null'], enum: [...TAMA_CITIES, null] },
      openingDate: { type: ['string', 'null'] },
      reason: { type: 'string' },
      signals: { type: 'array', items: { type: 'string' } },
    },
    required: ['verdict', 'storeName', 'genre', 'city', 'openingDate', 'reason', 'signals'],
  },
};

const strOrNull = (v: unknown, field: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new Error(`invalid ${field}`);
  return v;
};

/** Validates raw tool output; throws on anything malformed so the caller can retry. */
export function parseClassification(raw: unknown): Classification {
  if (typeof raw !== 'object' || raw === null) throw new Error('tool input is not an object');
  const r = raw as Record<string, unknown>;
  if (typeof r.verdict !== 'string' || !VERDICTS.includes(r.verdict as Verdict)) {
    throw new Error(`invalid verdict: ${String(r.verdict)}`);
  }
  let genre: Genre | null = null;
  if (r.genre !== null && r.genre !== undefined) {
    if (typeof r.genre !== 'string' || !GENRE_IDS.includes(r.genre as Genre)) {
      throw new Error(`invalid genre: ${String(r.genre)}`);
    }
    genre = r.genre as Genre;
  }
  const signals = Array.isArray(r.signals) ? r.signals.filter((s): s is string => typeof s === 'string') : [];
  return {
    verdict: r.verdict as Verdict,
    storeName: strOrNull(r.storeName, 'storeName'),
    genre,
    city: strOrNull(r.city, 'city'),
    openingDate: strOrNull(r.openingDate, 'openingDate'),
    reason: typeof r.reason === 'string' ? r.reason : '',
    signals,
  };
}

/** Per-request bound so one hung call cannot eat the process Lambda's time budget. */
export const ANTHROPIC_CLIENT_OPTIONS = { timeout: 30_000, maxRetries: 2 };

const jstDate = (d: Date): string => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

export function buildUserContent({ text, authorHandle, postedAt, now }: ClassifyInput): string {
  return [
    ...(now ? [`今日の日付: ${jstDate(now)}`] : []),
    `投稿者: ${authorHandle ?? '不明'}`,
    `投稿日時: ${postedAt ? postedAt.toISOString() : '不明'}`,
    '--- 投稿本文 ---',
    text,
  ].join('\n');
}

export function anthropicClassifier(apiKey: string, model = 'claude-haiku-5-5'): LlmClassifier {
  const client = new Anthropic({ apiKey, ...ANTHROPIC_CLIENT_OPTIONS });
  return {
    async classify(input) {
      const userContent = buildUserContent(input);
      const res = await client.messages.create({
        model,
        max_tokens: 1024,
        // Forced single-tool use is incompatible with thinking, so thinking is off.
        thinking: { type: 'disabled' },
        system: SYSTEM_PROMPT,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: userContent }],
      });
      const block = res.content.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
      if (!block || block.type !== 'tool_use') throw new Error('no tool_use block in LLM response');
      return parseClassification(block.input);
    },
  };
}
