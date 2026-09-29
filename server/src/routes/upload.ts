import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { ApiError } from '../middleware/errors.js';
import { uploadImage } from '../lib/cloudinary.js';
import { hit } from '../lib/rateLimiter.js';
import type { Request, Response } from 'express';

const router = Router();

const uploadSchema = z.object({
  dataUrl: z.string().min(20).max(1_500_000), // ~1MB base64 payload cap
});

router.post(
  '/avatar',
  requireAuth,
  validate(uploadSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (req.role === 'guest') throw new ApiError(403, 'Guests cannot upload avatars');
    const rl = hit(`upload:${req.userId}`, 10, 60_000);
    if (!rl.ok) throw new ApiError(429, 'Too many uploads');

    const dataUrl = String(req.body.dataUrl);
    if (!dataUrl.startsWith('data:image/')) {
      throw new ApiError(400, 'Only image data URLs are allowed');
    }
    if (dataUrl.length > 1_100_000) {
      throw new ApiError(413, 'Image too large (max ~800KB)');
    }

    const { url, publicId } = await uploadImage(dataUrl, 'pulse-chat/avatars');
    res.json({ url, publicId });
  })
);

export default router;
