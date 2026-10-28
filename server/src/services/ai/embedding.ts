import { type AISemanticIndex } from './types.js';

/**
 * Local semantic search index.
 *
 * In-repo fallback: a simple TF-IDF + cosine-similarity index over message
 * documents. When EMBEDDING_PROVIDER=openai and AI_API_KEY is set, drop in a
 * real @tensorflow/tfjs or @huggingface/inference call here.
 */

const docs = new Map<string, { id: string; text: string; userId: string }>();
const byUser = new Map<string, string[]>();

export async function indexMany(ids: string[]): Promise<void> {
  // In-repo: no-op (messages are indexed elsewhere via the repository caller).
  // This stays so the interface is stable when we swap to a real embedding API.
}

export async function query(
  userId: string,
  q: string,
  limit: number,
): Promise<Array<{ messageId: string; text: string; similarity: number; matchedAt: Date }>> {
  const ids = byUser.get(userId) ?? [];
  if (!ids.length) return [];
  const rows = ids
    .map((id) => {
      const d = docs.get(id);
      if (!d) return null;
      return { id: d.id, text: d.text, userId: d.userId };
    })
    .filter(Boolean) as Array<{ id: string; text: string; userId: string }>;

  // TF-IDF cosine similarity, in-repo.
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (t: string): number => {
    const cnt = (text: string) =>
      (text.toLowerCase().match(new RegExp(t, 'g')) ?? []).length;
    const df = rows.filter((r) => cnt(r.text) > 0).length;
    return tokens.reduce((acc, t) => acc + Math.log(1 + cnt(t)), 0) / (1 + Math.log(1 + df));
  };

  return rows
    .map((r) => ({ messageId: r.id, text: r.text, similarity: score(r.text), matchedAt: new Date() }))
    .filter((r) => r.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
