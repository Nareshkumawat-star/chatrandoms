/// AI (Large Language Model) service types.
///
/// This module intentionally has NO third-party AI dependencies. The client
/// shell keeps TypeScript happy and decouples us from any single provider.
/// Drop in a real provider (OpenAI, Anthropic, local embeddings) by
/// implementing the `AIConfig` in config/ai.ts and the `buildClient` in
/// src/services/ai/client.ts.
///
/// Env vars (see .env.example):
///   AI_PROVIDER=openai   // "openai" | "anthropic" | "local" | "off"
///   AI_MODEL=gpt-4o-mini
///   OPENAI_API_KEY=sk-...
///   EMBEDDING_PROVIDER=local   // "local" (simple TF-IDF/BM25) | "openai"

export type AIProvider = 'openai' | 'anthropic' | 'local' | 'off';
export type EmbeddingProvider = 'local' | 'openai';

export interface AIUserMessages {
  // AI-generated summaries for a conversation
  summaries: Array<{
    conversationId: string;
    text: string;
    model: string;
    createdAt: Date;
  }>;
  // AI-generated "smart replies" for a conversation
  smartReplies: Array<{
    conversationId: string;
    text: string;
    model: string;
    createdAt: Date;
  }>;
  // AI-generated action-item extraction from a conversation
  actions: Array<{
    conversationId: string;
    task: string;
    dueAt: Date | null;
    model: string;
    createdAt: Date;
  }>;
}

export interface AISemanticIndex {
  // user -> list of messages matched against a semantic query
  query: (userId: string, q: string, limit: number) => Promise<{
    messageId: string;
    text: string;
    similarity: number;
    matchedAt: Date;
  }[]>;
  // bulk index a batch of message ids
  indexMany: (ids: string[]) => Promise<void>;
}

export interface AISummaryRequest {
  conversationId: string;
  userId: string;
  text: string; // newest window of message text, or empty for 'recall summary'
  doSummarize: boolean;
  doSmartReply: boolean;
}

export interface AISummaryResponse {
  summary?: string;
  smartReply?: string;
  actions?: string[];
  error?: string;
}

export interface AIService {
  provider: AIProvider;
  ready: boolean;
  init(): Promise<void>;
  // one-shot chat-completions call
  chat(completion: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    system?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string }>;
  // semantic search via embeddings
  semantic: AISemanticIndex;
  // background summarization job
  submitSummary(req: AISummaryRequest): Promise<AISummaryResponse>;
}
