import { bedrockClassifier, DEFAULT_CLASSIFY_MODEL_ID, type LlmClassifier } from '../classify/llm.js';
import { fakeHpbHttp } from '../fakes/hpbHttp.js';
import { fakeLlmClassifier } from '../fakes/llm.js';
import { createFakeGoogleMapsSource } from '../fakes/places.js';
import { fakeThreadsClient } from '../fakes/threads.js';
import { googleMapsSource } from '../sources/googleMaps/source.js';
import type { Source } from '../sources/types.js';
import { createThreadsSource, threadsSource } from '../sources/threads/source.js';
import { fakesEnabled, type Env } from './mode.js';

export interface ExternalDeps {
  sources: Source[];
  llm(): LlmClassifier;
  hpbHttp: typeof fetch;
}

/** CLASSIFY_MODEL_ID (default Haiku 5.5) and BEDROCK_REGION, falling back to AWS_REGION. */
export function bedrockSettingsFor(env: Env): { modelId: string; region: string | undefined } {
  return {
    modelId: env.CLASSIFY_MODEL_ID || DEFAULT_CLASSIFY_MODEL_ID,
    region: env.BEDROCK_REGION || env.AWS_REGION || undefined,
  };
}

/** Fakes only when APP_ENV=local and FAKE_EXTERNAL=1; otherwise the real clients. */
export function externalDepsFor(env: Env): ExternalDeps {
  if (fakesEnabled(env)) {
    return {
      sources: [createFakeGoogleMapsSource(), createThreadsSource(() => fakeThreadsClient())],
      llm: () => fakeLlmClassifier(),
      hpbHttp: fakeHpbHttp,
    };
  }
  return {
    sources: [googleMapsSource, threadsSource],
    llm: () => bedrockClassifier(bedrockSettingsFor(env)),
    hpbHttp: fetch,
  };
}
