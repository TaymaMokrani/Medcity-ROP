import { getToken, clearToken } from './auth';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const CREDENTIAL_ENDPOINTS = ['/auth/login', '/auth/register'];

let sessionExpiredHandler: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

/**
 * The token is no longer accepted. Drop it and tell the app.
 *
 * Exported because images are no longer plain URLs — they are fetched with
 * the token like anything else, so an expired session has to end the same way
 * whether the request that discovered it was for a record or for a photograph.
 */
export function reportSessionExpired(): void {
  clearToken();
  sessionExpiredHandler?.();
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));

    if (response.status === 401 && !CREDENTIAL_ENDPOINTS.includes(path)) {
      reportSessionExpired();
    }

    throw new ApiError(
      errorData.message || 'API request failed',
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Where a stored photograph is fetched from.
 *
 * A record holds a storage key — `detections/<uuid>.jpg` — not a path or a
 * URL. The photograph lives in object storage behind the gateway, and the
 * gateway's `/files/<key>` route streams it after checking the same bearer
 * token as everything else and that the file belongs to the doctor asking. A
 * retinal photograph is patient data; there is no URL that opens it without
 * that check.
 *
 * That means the result cannot go straight into `<img src>`, because an image
 * element sends no Authorization header. Use `useAsset` or `AuthImage`, which
 * fetch through this and hand back a blob URL.
 */
export function assetUrl(path: string): string {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${BASE_URL}/files/${path.replace(/^\/+/, '')}`;
}

export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof TypeError)
    return "Can't reach the server. Check your connection and try again.";
  return fallback;
}

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
