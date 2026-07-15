import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { proctorApi } from '@/services/api';

export type ScreenShareStatus =
  | 'IDLE'
  | 'REQUESTING'
  | 'ACTIVE'
  | 'DENIED'
  | 'STOPPED'
  | 'UNSUPPORTED'
  /**
   * The candidate granted the share but picked a window or a browser tab
   * instead of the entire monitor. We tear the stream back down and surface
   * a retry prompt — the exam may not start until the candidate shares the
   * full screen so admins can see if a second display, an unauthorized app,
   * or another browser window is being used.
   */
  | 'WRONG_SURFACE';

/** What the candidate actually picked in the picker. `null` until granted. */
export type ScreenSurface = 'monitor' | 'window' | 'browser' | 'unknown';

export interface ScreenCaptureState {
  status: ScreenShareStatus;
  /** Last time a thumbnail was successfully POSTed. */
  lastSentAt: number | null;
  /** Last error surfaced by getDisplayMedia or the upload. */
  error: string | null;
  /** Frame count since `start()` — handy for debug overlays. */
  framesSent: number;
  /**
   * Surface type read from `MediaTrackSettings.displaySurface` after the
   * share was granted. `null` if no share is currently active.
   * Chrome/Edge always populate this; Firefox/Safari may report 'unknown'.
   */
  surface: ScreenSurface | null;
}

interface Options {
  enabled: boolean;
  sessionId?: string;
  /** Thumbnail cadence (ms). Default 3 000. */
  thumbMs?: number;
  /**
   * Live-thumbnail width (px) for the admin monitor stream. Height follows
   * aspect ratio. Default 480 — small enough to stream every 3 s without
   * eating bandwidth (~25 KB / frame at q=0.7) but readable enough that an
   * admin can identify what's on the candidate's screen at a glance. Bump
   * to 640+ if your admins need to read on-screen text from the live feed.
   */
  targetWidth?: number;
  /** JPEG quality 0–1 for the live thumb. Default 0.7 (was 0.55 before). */
  quality?: number;
  /**
   * Max width (px) for the HIGH-QUALITY evidence frame captured on-demand
   * when the AI flags cheating. Frames smaller than this are kept at native
   * resolution; larger frames (4K monitors) are downscaled to this width.
   * Default 1600 — readable enough to see app windows and chat content
   * clearly, ~150 KB at q=0.85.
   */
  evidenceMaxWidth?: number;
  /** JPEG quality 0–1 for the HD evidence frame. Default 0.85. */
  evidenceQuality?: number;
}

/**
 * Captures the candidate's screen via `getDisplayMedia()` and forwards
 * downscaled JPEG thumbnails to the admin monitor every `thumbMs`. Frames are
 * never persisted server-side — they ride a Redis pub/sub channel directly to
 * connected admin sockets.
 *
 * `start()` MUST be called from a user gesture (click handler) — the browser
 * blocks `getDisplayMedia` outside one. Stopping the share via the browser's
 * built-in "Stop sharing" pill flips status back to `STOPPED`.
 */
export interface ScreenFrameSnapshot {
  /** Base64 JPEG (no `data:` prefix), keyed to `ts`. */
  b64: string;
  /** Epoch ms when the frame was captured. */
  ts: number;
}

export function useScreenCaptureMonitor(opts: Options): {
  state: ScreenCaptureState;
  /**
   * Prompt the candidate for screen-share permission. Resolves to the
   * resulting status after the picker closes — callers (the consent submit
   * flow) check for `'ACTIVE'` before proceeding so a wrong-surface or
   * denied share blocks exam start instead of silently leaving an orphan.
   */
  start: () => Promise<ScreenShareStatus>;
  stop: () => void;
  /**
   * Returns the most recent live-monitor thumbnail. Low resolution / quality
   * — kept around for callers that just need a "the candidate's screen
   * looks like this" hint without paying the HD encode cost. For evidence
   * frames sent to AI / saved on cheating verdicts, prefer
   * `captureEvidenceFrame()` which returns a fresh full-resolution capture.
   */
  getLatestFrame: () => ScreenFrameSnapshot | null;
  /**
   * Capture a fresh HIGH-QUALITY screen frame from the live video element,
   * intended as evidence material when the AI flags cheating. Returns the
   * full screen at native resolution (downscaled only if wider than
   * `evidenceMaxWidth`) at `evidenceQuality` JPEG. Returns null if the
   * share isn't currently active. Cost: ~30–80 ms per call depending on
   * monitor resolution; safe to call inline from the AI-review tick.
   */
  captureEvidenceFrame: () => Promise<ScreenFrameSnapshot | null>;
} {
  const {
    enabled,
    sessionId,
    thumbMs = 5_000,
    targetWidth = 480,
    quality = 0.7,
    evidenceMaxWidth = 1600,
    evidenceQuality = 0.85,
  } = opts;
  const [state, setState] = useState<ScreenCaptureState>({
    status: 'IDLE',
    lastSentAt: null,
    error: null,
    framesSent: 0,
    surface: null,
  });
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const latestFrameRef = useRef<ScreenFrameSnapshot | null>(null);

  // Mount a hidden <video> element once and tear it down on unmount. We never
  // mutate `videoRef` outside of effects so the React Compiler's immutability
  // pass stays happy; everything else just attaches/detaches the stream.
  useEffect(() => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.style.position = 'fixed';
    v.style.left = '-9999px';
    v.style.top = '0';
    v.style.width = '1px';
    v.style.height = '1px';
    v.style.opacity = '0';
    v.style.pointerEvents = 'none';
    document.body.appendChild(v);
    videoRef.current = v;
    return () => {
      videoRef.current = null;
      if (v.parentNode) v.parentNode.removeChild(v);
    };
  }, []);

  const cleanup = useCallback(() => {
    if (tickTimerRef.current) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
    // Drop the cached frame so a denied/stopped share doesn't keep handing
    // stale evidence to the AI-review tick after the candidate has revoked.
    latestFrameRef.current = null;
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setState((s) => ({ ...s, status: 'STOPPED', surface: null }));
  }, [cleanup]);

  const captureThumb = useCallback(async (): Promise<string | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const w = Math.min(targetWidth, v.videoWidth);
    const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w));
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const bitmap = await createImageBitmap(v);
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        if (!ctx) {
          bitmap.close?.();
          return null;
        }
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
        const buf = await blob.arrayBuffer();
        const u8 = new Uint8Array(buf);
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < u8.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
        }
        return btoa(bin);
      } catch {
        /* fall through */
      }
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality).split(',')[1] ?? null;
  }, [quality, targetWidth]);

  const tick = useCallback(async () => {
    if (!sessionId) return;
    if (inFlightRef.current) return;
    const b64 = await captureThumb();
    if (!b64) return;
    // Cache the freshest frame for the AI-review tick BEFORE attempting the
    // upload — even if the admin-monitor POST fails (403 during the brief
    // CREATED → IN_PROGRESS race, or transient network), the frame is still
    // valid evidence locally and should be available for the next AI tick.
    latestFrameRef.current = { b64, ts: Date.now() };
    inFlightRef.current = true;
    try {
      await proctorApi.screenThumb(sessionId, b64, Date.now());
      setState((s) => ({
        ...s,
        lastSentAt: Date.now(),
        framesSent: s.framesSent + 1,
        error: null,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'screen thumb upload failed';
      console.warn('[screen] thumb upload failed', err);
      setState((s) => ({ ...s, error: msg }));
    } finally {
      inFlightRef.current = false;
    }
  }, [captureThumb, sessionId]);

  const start = useCallback(async (): Promise<ScreenShareStatus> => {
    if (streamRef.current) return 'ACTIVE';
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      setState((s) => ({ ...s, status: 'UNSUPPORTED', error: 'getDisplayMedia not available' }));
      return 'UNSUPPORTED';
    }
    setState((s) => ({ ...s, status: 'REQUESTING', error: null }));
    try {
      // Picker hints (Chromium 107+; ignored elsewhere — typed loosely so
      // older lib.dom.d.ts builds don't reject the extra fields):
      //  • displaySurface:'monitor' — preselects the "Entire screen" tab so
      //    candidates don't have to hunt for it.
      //  • monitorTypeSurfaces:'include' — explicitly keep the monitor tab.
      //  • selfBrowserSurface:'exclude' — removes the AXIS tab itself from
      //    the picker so candidates can't accidentally share the exam page
      //    (which would create a Hall-of-Mirrors loop and bypass admin
      //    monitoring of any other window).
      //  • surfaceSwitching:'exclude' — disables the in-share "Share this
      //    tab instead" button mid-exam, preventing surface-downgrade
      //    attacks.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const constraints: any = {
        video: {
          frameRate: { ideal: 8, max: 15 },
          displaySurface: 'monitor',
        },
        audio: false,
        monitorTypeSurfaces: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      streamRef.current = stream;

      // displaySurface guard. The constraint above is treated by Chromium as
      // a *hint* (not a constraint) so the candidate can still choose Window
      // or Tab in the picker. We must verify what they actually picked and
      // tear the stream down if it's not the full monitor. Per spec, Firefox
      // and Safari may report 'unknown' — Safari forces full-screen capture
      // anyway and Firefox is rare enough on proctored exams that we err on
      // the strict side and accept 'unknown' so the exam isn't blocked on
      // unsupported telemetry. Chrome/Edge always populate displaySurface.
      const track = stream.getVideoTracks()[0];
      const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & {
        displaySurface?: string;
      };
      const rawSurface = settings.displaySurface;
      const surface: ScreenSurface =
        rawSurface === 'monitor' || rawSurface === 'window' || rawSurface === 'browser'
          ? rawSurface
          : 'unknown';

      if (surface === 'window' || surface === 'browser') {
        // Wrong surface — release the stream and surface a retry prompt.
        // We do NOT save the cached frame because no proctor evidence has
        // been captured yet from this share.
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setState((s) => ({
          ...s,
          status: 'WRONG_SURFACE',
          surface,
          error: surface === 'window' ? 'window-not-allowed' : 'tab-not-allowed',
        }));
        return 'WRONG_SURFACE';
      }

      const v = videoRef.current;
      if (!v) {
        // Component unmounted between the prompt and the resolution. Drop the
        // stream so we don't leak the OS-level capture.
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return 'STOPPED';
      }
      v.srcObject = stream;
      await v.play().catch(() => {});

      // The user can stop the share via the browser's native "Stop sharing"
      // pill — listen for the track ending so our state stays accurate.
      stream.getVideoTracks().forEach((t) => {
        t.addEventListener('ended', () => {
          cleanup();
          setState((s) => ({ ...s, status: 'STOPPED', surface: null }));
        });
      });

      setState((s) => ({ ...s, status: 'ACTIVE', error: null, surface }));
      window.setTimeout(() => void tick(), 1_000);
      tickTimerRef.current = window.setInterval(() => void tick(), thumbMs);
      return 'ACTIVE';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Screen share denied';
      cleanup();
      setState((s) => ({ ...s, status: 'DENIED', error: msg, surface: null }));
      return 'DENIED';
    }
  }, [cleanup, thumbMs, tick]);

  // Disabled-state cleanup. We only invoke `cleanup()` (which does NOT touch
  // React state — just timers + streams + DOM srcObject), and intentionally
  // skip the IDLE setState here to keep the effect free of cascading renders.
  // The `STOPPED` status set by `stop()` is good enough signal for the UI.
  useEffect(() => {
    if (!enabled) cleanup();
    return () => {
      cleanup();
    };
  }, [enabled, cleanup]);

  const getLatestFrame = useCallback((): ScreenFrameSnapshot | null => latestFrameRef.current, []);

  /**
   * On-demand HIGH-QUALITY capture used for evidence (NOT for the live
   * monitor stream). Reads pixels from the same hidden <video> the live
   * tick uses, so as long as the share is active we always have a fresh
   * frame available without a second getDisplayMedia call. Falls through
   * to the synchronous canvas path if OffscreenCanvas isn't available.
   */
  const captureEvidenceFrame = useCallback(async (): Promise<ScreenFrameSnapshot | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !streamRef.current) return null;
    const srcW = v.videoWidth;
    const srcH = v.videoHeight;
    const w = Math.min(evidenceMaxWidth, srcW);
    const h = Math.max(1, Math.round((srcH / srcW) * w));
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const bitmap = await createImageBitmap(v);
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        if (!ctx) {
          bitmap.close?.();
          return null;
        }
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const blob = await c.convertToBlob({ type: 'image/jpeg', quality: evidenceQuality });
        const buf = await blob.arrayBuffer();
        const u8 = new Uint8Array(buf);
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < u8.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
        }
        return { b64: btoa(bin), ts: Date.now() };
      } catch {
        /* fall through */
      }
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    const b64 = c.toDataURL('image/jpeg', evidenceQuality).split(',')[1] ?? null;
    return b64 ? { b64, ts: Date.now() } : null;
  }, [evidenceMaxWidth, evidenceQuality]);

  return { state, start, stop, getLatestFrame, captureEvidenceFrame };
}

export function ScreenSharePrompt({
  state,
  onStart,
  disabled,
}: {
  state: ScreenCaptureState;
  onStart: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  if (state.status === 'ACTIVE') {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-300">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span>{t('screen.active')}</span>
        <span className="opacity-60 font-mono">{state.framesSent}f</span>
      </div>
    );
  }
  // Wrong-surface gets a dedicated, more emphatic warning + immediate retry
  // button. Spelled out clearly because most candidates pick "Window" by
  // accident on the first attempt — the picker defaults vary by OS.
  if (state.status === 'WRONG_SURFACE') {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="text-xs text-red-300 text-center max-w-xs leading-snug">
          {state.surface === 'browser' ? t('screen.wrongTab') : t('screen.wrongWindow')}
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={disabled}
          className="text-xs px-2.5 py-1 rounded border border-red-300/40 bg-red-500/15 text-red-100 hover:bg-red-500/25 disabled:opacity-50 font-semibold"
        >
          {t('screen.retryEntire')}
        </button>
      </div>
    );
  }
  const label =
    state.status === 'REQUESTING'
      ? t('screen.requesting')
      : state.status === 'DENIED'
      ? t('screen.retryDenied')
      : state.status === 'STOPPED'
      ? t('screen.resume')
      : state.status === 'UNSUPPORTED'
      ? t('screen.unsupported')
      : t('screen.start');
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={disabled || state.status === 'REQUESTING' || state.status === 'UNSUPPORTED'}
      className="text-xs px-2.5 py-1 rounded border border-amber-300/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
    >
      {label}
      {state.error && state.status === 'DENIED' && (
        <span className="ml-2 opacity-70 italic">({state.error})</span>
      )}
    </button>
  );
}
