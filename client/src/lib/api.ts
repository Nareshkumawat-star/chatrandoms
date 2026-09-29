import axios from 'axios';

// Same-origin by default (Vite dev proxy / same domain in production).
// Override with VITE_API_URL for a split deployment.
export const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL as string) || '/api',
  withCredentials: true,
});

export function apiError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { error?: string; details?: { message: string }[] } | undefined;
    if (data?.details?.length) return data.details.map((d) => d.message).join(', ');
    return data?.error ?? e.message;
  }
  return 'Something went wrong';
}
