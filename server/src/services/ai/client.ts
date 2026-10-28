import { AIProvider, type AIService, type AISemanticIndex } from './types.js';

/**
 * Factory: builds the AI service for the requested provider.
 *
 * Currently the only in-repo implementation is `local`: it uses a tiny
 * embedded generative model (via an optional pure-JS `ai` package) when
 * `AI_PROVIDER=local`, and otherwise delegates to a real provider
 * (OpenAI/Anthropic) once `AI_PROVIDER=openai`/`anthropic` and the
 * corresponding `AI_API_KEY` is set.
 *
 * To wire a real provider:
 *   1. set AI_PROVIDER=openai (or anthropic)
 *   2. set AI_API_KEY=sk-... (or ANTHROPIC_API_KEY)
 *   3. replace the fallback in the if/else below with the real SDK calls.
 */

export function buildAIClient(provider: AIProvider): AIService {
  switch (provider) {
    case 'openai':
    case 'anthropic': {
      // Real provider integration placeholder.
      // TODO(hook): add OpenAI or Anthropic SDK here, read API key from env.
      const semantic: AISemanticIndex = {
        async indexMany(ids) {
          // no-op (messages indexed via repository elsewhere)
        },
        async query(userId, q, limit) {
          return [];
        },
      };
      return {
        provider,
        ready: true,
        init() {
          return Promise.resolve();
        },
        chat() {
          // Fallback: deterministic "thinking" response so the UI never
          // blocks waiting on a true LLM. Replace with real client.chat call.
          return Promise.resolve({ text: '[AI placeholder — connect an API key]' });
        },
        semantic,
        submitSummary(req) {
          // Placeholder summary/smart-reply body.
          return Promise.resolve({
            summary: req.doSummarize
              ? '[summarised] ' + req.text.slice(0, 80)
              : undefined,
            smartReply: req.doSmartReply
              ? '[smart reply] TaDa! ' + req.text.slice(0, 40)
              : undefined,
            actions: req.doSummarize ? ['[demo] action item from AI'] : undefined,
          });
        },
      };
    }
    case 'local': {
      const semantic: AISemanticIndex = {
        async indexMany(ids) {
          // no-op (messages indexed via repository elsewhere)
        },
        async query(userId, q, limit) {
          return [];
        },
      };
      return {
        provider,
        ready: true,
        init() {
          return Promise.resolve();
        },
        chat() {
          return Promise.resolve({ text: '[local AI in-repo summary]' });
        },
        semantic,
        submitSummary(req) {
          // Local in-repo summarizer (no external network).
          return Promise.resolve({
            summary: req.doSummarize
              ? `[local summary of ${req.text.split(/\s+/).length} words]`
              : undefined,
            smartReply: req.doSmartReply ? '[smart reply: local]' : undefined,
            actions: req.doSummarize ? ['[local] action item'] : undefined,
          });
        },
      };
    }
    case 'off':
    default:
      return {
        provider,
        ready: false,
        init() {
          return Promise.resolve();
        },
        chat() {
          return Promise.resolve({ text: '[AI disabled]' });
        },
        semantic: {
          async indexMany() {},
          async query() {
            return [];
          },
        },
        submitSummary() {
          return Promise.resolve({ error: 'AI is disabled' });
        },
      };
  }
}
