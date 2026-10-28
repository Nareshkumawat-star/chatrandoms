import { AIProvider, EmbeddingProvider } from './types.js';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  embeddingProvider: EmbeddingProvider;
  apiKey: string | null;
}

export function loadAIConfig(): AIConfig {
  return {
    provider: (process.env.AI_PROVIDER as AIProvider) || 'local',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    embeddingProvider: (process.env.EMBEDDING_PROVIDER as EmbeddingProvider) || 'local',
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || null,
  };
}
