import { io, Socket } from 'socket.io-client';
import { resolveApiBase, resolveSocketOrigin } from '@/lib/socketOrigin';

let socket: Socket | null = null;
/**
 * Single in-flight refresh promise so multiple parallel auth-failed reconnects
 * don't all hammer /auth/refresh at once. Resolves to true if a fresh access
 * token was written to localStorage, false if refresh failed or there's no
 * refresh token to use.
 */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Storm guard: when the server keeps disconnecting us (bad / missing roles in
 * JWT, stale token, expired refresh, etc.), we used to call socket.connect()
 * the instant the disconnect handler fired, with no delay and no fail-stop.
 * That produced ~50 req/s of WS handshakes against the backend until the user
 * closed the tab. The constants below cap the recovery loop:
 *
 *   - MIN_RECONNECT_DELAY_MS:   floor between two manual reconnect attempts.
 *   - MAX_AUTH_FAILURES:        consecutive auth-related disconnects before
 *                               we give up and redirect to login.
 */
const MIN_RECONNECT_DELAY_MS = 2_000;
const MAX_AUTH_FAILURES = 3;

let consecutiveAuthFailures = 0;
let lastReconnectAt = 0;
let reconnectTimer: number | null = null;
let bailedOut = false;

function bailToLogin(): void {
  if (bailedOut) return;
  bailedOut = true;
  try {
    socket?.disconnect();
  } catch {
    /* ignore */
  }
  socket = null;
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminRefreshToken');
  if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/login')) {
    window.location.href = '/axis_manager/login';
  }
}

/** Schedule a manual reconnect, but no sooner than MIN_RECONNECT_DELAY_MS
 *  after the previous attempt. Coalesces multiple callers into one timer. */
function scheduleReconnect(): void {
  if (bailedOut || !socket) return;
  if (reconnectTimer != null) return;
  const wait = Math.max(0, MIN_RECONNECT_DELAY_MS - (Date.now() - lastReconnectAt));
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (bailedOut || !socket) return;
    lastReconnectAt = Date.now();
    socket.connect();
  }, wait);
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = localStorage.getItem('adminRefreshToken');
  if (!refreshToken) return false;
  const apiBase = resolveApiBase();
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${apiBase}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (!data.accessToken) return false;
      localStorage.setItem('adminToken', data.accessToken);
      if (data.refreshToken) localStorage.setItem('adminRefreshToken', data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export function getAdminSocket(): Socket {
  if (socket) return socket;

  // Auth callback (vs static `auth: { token }`) is invoked by socket.io-client
  // on every connection AND every reconnection attempt, so a token refreshed
  // mid-session is automatically picked up without re-creating the socket.
  // Same origin resolution as CBT/expert sockets: production SPA is on
  // axisexam.com while Socket.IO lives on api.axisexam.com (not the SPA host).
  const wsBase = resolveSocketOrigin();
  socket = io(`${wsBase}/admin`, {
    auth: (cb) => cb({ token: localStorage.getItem('adminToken') ?? '' }),
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
  });

  // Successful connect resets the storm-guard counters.
  socket.on('connect', () => {
    consecutiveAuthFailures = 0;
    bailedOut = false;
  });

  // When the server kicks us for bad auth (expired / wrong-role JWT), the
  // socket would otherwise just retry forever with the same dead token.
  // Try a single token refresh — if it succeeds, the next auto-reconnect
  // (which re-evaluates the auth callback above) will use the new token.
  // If refresh fails, the user is genuinely logged out and the upstream UI
  // shows the "WS reconnecting…" pill, prompting a manual re-login.
  socket.on('connect_error', (err) => {
    const msg = (err as { message?: string })?.message ?? '';
    if (/auth|token|jwt|unauth/i.test(msg) || msg === 'xhr poll error') {
      void refreshAccessToken();
    }
  });
  socket.on('disconnect', (reason) => {
    if (reason !== 'io server disconnect') return;
    // Server-initiated disconnect = JWT verify or role check failed. Auto
    // reconnection is suppressed by socket.io for this reason, so we drive
    // recovery manually — but with a hard cap, otherwise a permanently bad
    // token spins forever at network speed.
    consecutiveAuthFailures += 1;
    if (consecutiveAuthFailures >= MAX_AUTH_FAILURES) {
      bailToLogin();
      return;
    }
    void refreshAccessToken().then((ok) => {
      if (!ok) {
        // Refresh token also dead — no point retrying with the same bad
        // access token; cut losses and route the operator to login.
        bailToLogin();
        return;
      }
      scheduleReconnect();
    });
  });

  return socket;
}

export function disconnectAdminSocket(): void {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.disconnect();
  socket = null;
  consecutiveAuthFailures = 0;
  bailedOut = false;
  lastReconnectAt = 0;
}
