import axios from 'axios';
import { setSocketToken } from './socket';

// Same-origin by default (Vite dev proxy / same domain in production).
// Override with VITE_API_URL for a split deployment.
export const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL as string) || '/api',
  withCredentials: true,
});

// Attach Authorization header if access token exists in localStorage
api.interceptors.request.use((reqConfig) => {
  const token = localStorage.getItem('pulsechat_token');
  if (token && reqConfig.headers && !reqConfig.headers.Authorization) {
    reqConfig.headers.Authorization = `Bearer ${token}`;
  }
  return reqConfig;
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Auto-refresh token if 401 encountered on authenticated routes
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (!originalRequest || originalRequest._retry) {
      return Promise.reject(error);
    }

    // Skip intercepting auth endpoints themselves to prevent endless loops
    const url = originalRequest.url || '';
    if (
      url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/guest')
    ) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('pulsechat_refresh');
      try {
        const { data } = await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          { refreshToken },
          { withCredentials: true }
        );
        const newAccessToken = data.accessToken;
        const newRefreshToken = data.refreshToken;
        if (newAccessToken) {
          localStorage.setItem('pulsechat_token', newAccessToken);
          if (newRefreshToken) localStorage.setItem('pulsechat_refresh', newRefreshToken);
          api.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;
          setSocketToken(newAccessToken);
          processQueue(null, newAccessToken);
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(originalRequest);
        }
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        localStorage.removeItem('pulsechat_token');
        localStorage.removeItem('pulsechat_refresh');
        delete api.defaults.headers.common['Authorization'];
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export function apiError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as
      | { error?: string; message?: string; details?: { message: string }[] | string }
      | undefined;
    if (Array.isArray(data?.details) && data.details.length) {
      return data.details.map((d) => (typeof d === 'string' ? d : d.message)).join(', ');
    }
    if (typeof data?.details === 'string') return data.details;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
    if (e.response?.status === 429) return 'Too many attempts. Please wait a minute and try again.';
    if (e.response?.status === 401) return 'Invalid credentials. Please check your details.';
    if (e.response?.status === 403) return 'Access denied.';
    if (e.response?.status && e.response.status >= 500) return 'Server error. Please try again shortly.';
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
