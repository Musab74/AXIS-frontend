/**
 * Resolve the Socket.IO server origin (no trailing slash, no `/api` path).
 *
 * HTTP APIs often use a relative `/api` Vite/Apache proxy. Socket.IO speaks
 * on `/socket.io` at the Nest origin, which is a different host in production
 * (`api.axisexam.com`) and a different port in local Vite (`:3333`).
 */
export function resolveSocketOrigin(): string {
  const wsEnv = (import.meta.env.VITE_WS_BASE_URL as string | undefined)?.trim();
  if (wsEnv) return wsEnv.replace(/\/$/, '');

  const apiEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (apiEnv && /^https?:\/\//i.test(apiEnv)) {
    try {
      return new URL(apiEnv).origin;
    } catch {
      return apiEnv.replace(/\/$/, '').replace(/\/api$/, '');
    }
  }

  if (typeof window === 'undefined') return '';

  const { protocol, hostname, port } = window.location;

  // Production SPA host → API host (Socket.IO is not served by the SPA).
  if (hostname === 'axisexam.com' || hostname === 'www.axisexam.com') {
    return `${protocol}//api.axisexam.com`;
  }
  if (hostname.startsWith('api.')) {
    return `${protocol}//${hostname}`;
  }

  // Local Vite / preview → Nest on :3333
  if (port === '5173' || port === '4173' || hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:3333`;
  }

  // Last resort: same-origin (requires a `/socket.io` reverse proxy).
  return '';
}

/** HTTP API base for fetch() helpers — mirrors admin `api.ts` default. */
export function resolveApiBase(): string {
  const api = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, '');
  return api && api.length > 0 ? api : '/api';
}
