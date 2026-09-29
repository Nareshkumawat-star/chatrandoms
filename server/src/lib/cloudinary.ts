import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config/env.js';
import { logger } from './logger.js';

const enabled = Boolean(
  config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret
);

if (enabled) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
} else {
  logger.warn('Cloudinary not configured — avatar uploads will be stored as data URLs');
}

export const cloudinaryEnabled = enabled;

export async function uploadImage(
  dataUrl: string,
  folder = 'pulse-chat'
): Promise<{ url: string; publicId: string | null }> {
  if (!enabled) {
    // Fallback: keep the data URL directly (small images only, enforced by caller).
    return { url: dataUrl, publicId: null };
  }
  const res = await cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: 'image',
    transformation: [{ width: 256, height: 256, crop: 'fill', quality: 'auto' }],
  });
  return { url: res.secure_url, publicId: res.public_id };
}

export async function deleteImage(publicId: string): Promise<void> {
  if (!enabled || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    logger.warn('Cloudinary destroy failed', err);
  }
}
