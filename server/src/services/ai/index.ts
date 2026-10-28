import { AIProvider } from './types.js';
import { loadAIConfig } from './config.js';
import { buildAIClient } from './client.js';

let instance: ReturnType<typeof buildAIClient> | null = null;

export async function getAIService(): Promise<ReturnType<typeof buildAIClient>> {
  if (instance) return instance;
  const cfg = loadAIConfig();
  const svc = buildAIClient(cfg.provider);
  await svc.init();
  if (!svc.ready) {
    console.warn('[ai] AI is disabled (provider=off)');
  }
  instance = svc;
  return instance;
}
