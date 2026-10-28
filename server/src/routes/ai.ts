import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { ApiError } from '../middleware/errors.js';
import { getAIService } from '../services/ai/index.js';

const router = Router();

// ---------- AI (Large Language Model) service ----------
// Wires in-repo AI services (summaries, smart replies, semantic search).
// Provider + API key configured via AI_PROVIDER / AI_API_KEY env vars.

router.post(
  '/summarize',
  requireAuth,
  validate(
    z.object({
      conversationId: z.string().regex(/^[a-f\d]{24}$/i, 'invalid conversationId'),
      doSummarize: z.boolean().optional().default(true),
      doSmartReply: z.boolean().optional().default(true),
      doExtractActions: z.boolean().optional().default(true),
    }),
    'body',
  ),
  asyncHandler(async (req, res) => {
    const ai = await getAIService();
    if (!ai.ready) {
      throw new ApiError(503, 'AI is disabled on this server');
    }
    const result = await ai.submitSummary({
      conversationId: req.body.conversationId,
      userId: req.userId!,
      text: '', // full-context summarization; 'text' is the latest window in
               // the repository. Pass a window of text here if you want
               // on-the-fly summaries without a separate recall.
      doSummarize: req.body.doSummarize,
      doSmartReply: req.body.doSmartReply,
    });
    res.json({ ok: true, ...result });
  }),
);

router.post(
  '/summarize/short',
  requireAuth,
  validate(
    z.object({
      conversationId: z.string().regex(/^[a-f\d]{24}$/i, 'invalid conversationId'),
      window: z.string().min(1).max(4000),
    }),
    'body',
  ),
  asyncHandler(async (req, res) => {
    const ai = await getAIService();
    if (!ai.ready) {
      throw new ApiError(503, 'AI is disabled on this server');
    }
    const result = await ai.submitSummary({
      conversationId: req.body.conversationId,
      userId: req.userId!,
      text: req.body.window,
      doSummarize: true,
      doSmartReply: false,
      
    });
    res.json({ ok: true, ...result });
  }),
);

router.post(
  '/semantic/search',
  requireAuth,
  validate(
    z.object({
      q: z.string().min(1).max(300),
      limit: z.coerce.number().int().min(1).max(50).optional().default(10),
    }),
    'body',
  ),
  asyncHandler(async (req, res) => {
    const ai = await getAIService();
    if (!ai.ready) {
      throw new ApiError(503, 'AI is disabled on this server');
    }
    const rows = await ai.semantic.query(req.userId!, req.body.q, req.body.limit);
    res.json({ ok: true, results: rows });
  }),
);

export default router;
