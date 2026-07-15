import { useEffect, useRef, useState } from 'react';
import { Minus, Move, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { aiProctorApi, proctorApi, type ProctorEventKind } from '@/services/api';
import { captureViolationFrames } from '@/proctor/violationEvidence';
import type { DetectorMessage, DetectorReply } from './proctorDetector.worker';

export type LiveVerdict =
  | 'OK'
  | 'PENDING'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'LOOK_AWAY'
  | 'EYES_CLOSED'
  | 'IDENTITY_MISMATCH'
  | 'AI_LOW'
  | 'AI_MED'
  | 'AI_HIGH'
  | 'ERROR';

export type AiSeverity = 'LOW' | 'MED' | 'HIGH';

export interface AiVerdictDetail {
  captionKo: string | null;
  captionEn: string | null;
  ruleBroken: string | null;
  evidenceUrl: string | null;
  /** Webcam JPEG used for this AI tick (no `data:` prefix) — for local evidence thumbnails. */
  frameBase64?: string | null;
}

export interface ProctorLiveState {
  verdict: LiveVerdict;
  faceCount: number | null;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
  eyeOpenRatio: number | null;
  warnings: number;        // running count of events fired to the server
  lastConfirmedAt: number | null;  // ts of last successful Rekognition confirm
  detectorMs: number | null;       // last on-device inference cost (debug)
  source: 'LOCAL' | 'SERVER' | null;
  identityMatched: boolean | null; // server's last identity-recheck verdict
  backend: string | null;          // tfjs backend the worker actually picked
}

interface Options {
  enabled: boolean;
  sessionId?: string;
  /** 'DEMO' or 'EXAM' — controls which reference face the server compares against. Default 'EXAM'. */
  purpose?: 'DEMO' | 'EXAM';
  /** ms — server confirm + identity re-check cadence. Default 30 000. */
  serverConfirmMs?: number;
  /** ms — local detector cadence. Default 200 (≈5 Hz). */
  localDetectMs?: number;
  /** ms — tier-1/tier-2 AI review cadence. Default 10 000. Disabled if no sessionId. */
  aiReviewMs?: number;
  /**
   * ms — live admin-monitor thumbnail cadence. Default 3 000 (≈20 KB/s per
   * candidate at 160×120 / quality 0.5). Disabled if no sessionId.
   */
  thumbMs?: number;
  /** Path the worker fetches face-api models from. Default '/models/face-api'. */
  modelUrl?: string;
  /**
   * Fires once per sustained non-OK verdict, immediately after the per-verdict
   * sustain window has elapsed. Runs regardless of whether `sessionId` is set,
   * so unauthenticated demo flows can still drive client-side strike counters.
   */
  onVerdictFired?: (verdict: LiveVerdict, detail: Record<string, unknown>) => void;
  /**
   * Fires every time the server returns a confirmed AI verdict (LOW/MED/HIGH).
   * The exam runner maps severity → strike: LOW = log only, MED = +1 strike +
   * banner, HIGH = immediate termination.
   */
  onAiVerdict?: (severity: AiSeverity, detail: AiVerdictDetail) => void;
  /**
   * Fires when the server reports that the session has been terminated due to
   * accumulated proctoring violations (face/gaze events reaching threshold).
   */
  onTerminated?: () => void;
  /**
   * Optional getter for the candidate's most recent shared screen frame
   * (base64 JPEG without the `data:` prefix). When provided, the AI-review
   * tick bundles it alongside the webcam frame so the backend can persist it
   * as additional evidence on a confirmed cheating verdict. Returning `null`
   * (no share active, or first capture not yet completed) is fine — the
   * pipeline degrades to webcam-only evidence.
   *
   * Used as a fallback when `captureScreenEvidence` is not provided. Prefer
   * `captureScreenEvidence` for HIGH-QUALITY evidence; this getter typically
   * returns the low-res live thumbnail, which is fine for AI input but
   * makes the saved evidence images grainy.
   */
  getLatestScreenFrame?: () => { b64: string; ts: number } | null;
  /**
   * Preferred: on-demand HIGH-QUALITY screen capture for evidence. If
   * provided, the AI-review tick will await this every 10 s instead of
   * reading the cached thumbnail. Adds ~30–80 ms per AI tick (acceptable)
   * in exchange for full-resolution evidence images that admins can
   * actually read.
   */
  captureScreenEvidence?: () => Promise<{ b64: string; ts: number } | null>;
  /**
   * Demo-only: custom AI review function called every `aiReviewMs` when no
   * `sessionId` is present. Receives (ts, base64) and should return the same
   * shape as `aiProctorApi.review`. If provided, the hook runs AI ticks even
   * without a sessionId.
   */
  demoAiReviewFn?: (ts: number, b64: string) => Promise<{
    data: {
      aiVerdict: string;
      captionKo: string | null;
      captionEn: string | null;
      ruleBroken: string | null;
      evidenceUrl: string | null;
    };
  }>;
}

interface SustainState {
  verdict: LiveVerdict;
  startedAt: number;
  fired: boolean;       // already POSTed to /proctor/event for this hold
}

// DUOLINGO-strict preset (user choice). Any sustained look-away is a strike;
// thresholds are intentionally aggressive. False positives WILL happen on:
//   • natural reading drift across a wide monitor (>15° eye yaw to read the
//     edge column at 50 cm distance);
//   • candidates with strong glasses reflections or heavy eyeliner (iris
//     cluster picks up wrong region);
//   • mid-typing keyboard glances (eye pitch dips ~10–14° even with the
//     keyboard directly under the camera).
// Tuning rationale: visual blur at ~150 ms (1–2 frames @ 10 Hz) so the user
// sees the warning the instant their eyes drift; strike at 500 ms so a
// genuine 3-strike termination requires only 1.5 s of cumulative look-away.
const DEFAULT_SUSTAIN_FIRE_MS = 3_000;
const SUSTAIN_FIRE_MS_BY_VERDICT: Partial<Record<LiveVerdict, number>> = {
  MULTIPLE_FACES: 500,
  LOOK_AWAY: 500,
};
const NO_FACE_MIN_MS = 1_500;    // a face dropout shorter than 1.5s is a blink
const LOOK_AWAY_MIN_MS = 150;    // overlay blur appears within 1–2 frames @ 10 Hz
const EYES_CLOSED_MIN_MS = 3_000; // anything under 3s is just blinking

// Head-pose threshold — 14°/-9° catches even small head turns toward a side
// monitor or a downward glance toward a phone/notes on the desk.
const YAW_LIMIT_DEG = 14;
const PITCH_DOWN_LIMIT_DEG = -9;
const EYE_OPEN_RATIO_THRESHOLD = 0.2;

// Iris-based eye gaze — independent of head pose. Catches candidates who keep
// their head facing the camera but cut their eyes sideways at a second monitor
// or a phone in their lap. DUOLINGO preset:
//   • |eyeYaw| > 10° = looking sideways
//   • eyePitch >  12° = looking down (e.g. lap, phone on desk below screen)
//   • eyePitch < -12° = looking up
// Confidence floor lowered to 0.2 so partially-occluded eyes (e.g. behind
// glasses lens edges) still contribute. Raise to 0.4+ if you see false
// positives on dark / blurry frames.
const EYE_YAW_LIMIT_DEG = 10;
const EYE_PITCH_DOWN_LIMIT_DEG = 12;
const EYE_PITCH_UP_LIMIT_DEG = -12;
const EYE_GAZE_MIN_CONFIDENCE = 0.2;

const VERDICT_TO_EVENT: Partial<Record<LiveVerdict, ProctorEventKind>> = {
  NO_FACE: 'NO_FACE',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  LOOK_AWAY: 'GAZE_AWAY',
  EYES_CLOSED: 'EYES_CLOSED',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
};

/**
 * Always-on proctor monitor: a face-api worker runs at ~5 Hz in the browser
 * for instant verdicts, and the existing Rekognition `face-check` endpoint
 * runs every 30s as the authoritative second opinion + identity re-check.
 *
 * The hook only fires `/proctor/event` once a non-OK local verdict has been
 * held for the configured sustain window (≥3s for face-related verdicts) so
 * blinks and quick glances at the keyboard don't spam the server.
 */
export function useProctorMonitorLive(opts: Options): {
  state: ProctorLiveState;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  start: () => Promise<void>;
  stop: () => void;
  /**
   * Capture the current video frame as a base64 JPEG (no `data:` prefix).
   * Returns null until the camera has produced its first frame. Used by the
   * demo runner to seed the in-process reference face at Start.
   */
  captureFrameBase64: () => string | null;
  /**
   * Live MediaStream the proctor camera holds — exposed so other monitors
   * (mic / MediaRecorder) can attach without opening a second getUserMedia
   * camera. Returns null until `start()` has resolved.
   */
  getMediaStream: () => MediaStream | null;
} {
  const {
    enabled,
    sessionId,
    purpose = 'EXAM',
    // Cadence dropped from 30s → 10s (proctor detection-gap-fix Step 3) so the
    // server-side Rekognition gate confirms gaze / face / identity at the same
    // pace as the client face-api signal. Backend throttle remains 30/min,
    // which comfortably accommodates 6/min. Cost is ~3× more DetectFaces calls
    // per exam (~$0.001/exam at AWS list price — negligible).
    serverConfirmMs = 10_000,
    // Worker tick at 10 Hz (was 5 Hz). The face-api `tinyFaceDetector` typically
    // runs in <30 ms on webgl, so 10 Hz is well within budget; the inFlight
    // guard drops overlapping ticks if the box is too slow. Halving the tick
    // interval halves the latency on every gaze / face-count signal.
    localDetectMs = 100,
    aiReviewMs = 10_000,
    thumbMs = 5_000,
    modelUrl = '/models/face-api',
    onVerdictFired,
    onAiVerdict,
    onTerminated,
    getLatestScreenFrame,
    captureScreenEvidence,
    demoAiReviewFn,
  } = opts;
  const onVerdictFiredRef = useRef(onVerdictFired);
  useEffect(() => {
    onVerdictFiredRef.current = onVerdictFired;
  }, [onVerdictFired]);
  const onAiVerdictRef = useRef(onAiVerdict);
  useEffect(() => {
    onAiVerdictRef.current = onAiVerdict;
  }, [onAiVerdict]);
  const onTerminatedRef = useRef(onTerminated);
  useEffect(() => {
    onTerminatedRef.current = onTerminated;
  }, [onTerminated]);
  // Mirror the screen-frame getter / capturer into refs so the AI-tick
  // closure (bound once via setInterval) always reads the latest
  // implementation without having to re-bind the timer when consumers swap
  // the callback. `captureScreenEvidence` (HD on-demand) takes priority
  // over `getLatestScreenFrame` (cached thumbnail) when both are provided.
  const captureScreenEvidenceRef = useRef(captureScreenEvidence);
  useEffect(() => {
    captureScreenEvidenceRef.current = captureScreenEvidence;
  }, [captureScreenEvidence]);
  const getLatestScreenFrameRef = useRef(getLatestScreenFrame);
  useEffect(() => {
    getLatestScreenFrameRef.current = getLatestScreenFrame;
  }, [getLatestScreenFrame]);
  const demoAiReviewFnRef = useRef(demoAiReviewFn);
  useEffect(() => {
    demoAiReviewFnRef.current = demoAiReviewFn;
  }, [demoAiReviewFn]);
  const terminatedRef = useRef(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const detectTimerRef = useRef<number | null>(null);
  const serverTimerRef = useRef<number | null>(null);
  const aiTimerRef = useRef<number | null>(null);
  // Timestamp of the AI review currently in flight (null = idle). A timestamp
  // instead of a boolean so a request that outlives both its axios timeout and
  // the watchdog window can never wedge the guard shut — a stuck `true` here
  // used to silently disable AI review (and phone detection with it) for the
  // remainder of the exam.
  const aiInFlightSinceRef = useRef<number | null>(null);
  const thumbTimerRef = useRef<number | null>(null);
  const thumbInFlightRef = useRef(false);
  const sustainRef = useRef<SustainState | null>(null);
  const inFlightDetectRef = useRef(false);
  const inFlightStartedAtRef = useRef<number>(0);
  const lastVerdictAtRef = useRef<number>(0);
  // Consecutive-failure counter for IDENTITY_MISMATCH. A single Rekognition
  // tick saying "not matched" is way too noisy (lighting, hair, glasses,
  // a half-turn at the wrong moment) — terminating an exam over one frame
  // produces false "another user" terminations. Require two consecutive
  // confirmed mismatches (~60s sustained) before firing.
  const identityMismatchStreakRef = useRef<number>(0);
  const IDENTITY_MISMATCH_REQUIRED_STREAK = 2;

  const initialState: ProctorLiveState = {
    verdict: 'PENDING',
    faceCount: null,
    yaw: null,
    pitch: null,
    roll: null,
    eyeOpenRatio: null,
    warnings: 0,
    lastConfirmedAt: null,
    detectorMs: null,
    source: null,
    identityMatched: null,
    backend: null,
  };

  const [state, setState] = useState<ProctorLiveState>(initialState);

  // Mirror state into a ref so handlers bound once at effect-time (the worker
  // onmessage closure) read the *current* verdict, not the stale 'PENDING'
  // captured at first render. Without this, the NO_FACE grace-window branch
  // below permanently treats the previous verdict as 'PENDING'.
  const stateRef = useRef<ProctorLiveState>(initialState);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /* ───────────────────────────── camera + worker setup ───────────────────────────── */
  const start = async () => {
    if (streamRef.current) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error('[proctor] camera permission denied', err);
      setState((p) => ({ ...p, verdict: 'ERROR' }));
    }
  };

  const stop = () => {
    if (detectTimerRef.current) {
      window.clearInterval(detectTimerRef.current);
      detectTimerRef.current = null;
    }
    if (serverTimerRef.current) {
      window.clearInterval(serverTimerRef.current);
      serverTimerRef.current = null;
    }
    if (aiTimerRef.current) {
      window.clearInterval(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    if (thumbTimerRef.current) {
      window.clearInterval(thumbTimerRef.current);
      thumbTimerRef.current = null;
    }
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'shutdown' } satisfies DetectorMessage);
      workerRef.current.terminate();
      workerRef.current = null;
    }
    // Stop tracks AND fully detach the stream from the <video> element.
    // On Chromium, leaving `srcObject` pointing to a stream — even one whose
    // tracks have been stopped — keeps the OS-level camera indicator (green
    // light) lit until the page itself unloads. Pausing, nulling srcObject,
    // and calling .load() forces the element to release its handle so the
    // light goes off immediately when the exam ends.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
        v.srcObject = null;
        v.removeAttribute('src');
        v.load();
      } catch {
        /* non-fatal */
      }
    }
    sustainRef.current = null;
  };

  /* ───────────────────────────── verdict reducer ───────────────────────────── */
  const fireEvent = (verdict: LiveVerdict, detail: Record<string, unknown>) => {
    // Always notify the caller — demo has no sessionId but still needs strikes.
    try {
      onVerdictFiredRef.current?.(verdict, detail);
    } catch (err) {
      console.warn('[proctor] onVerdictFired threw', err);
    }
    const eventType = VERDICT_TO_EVENT[verdict];
    if (!eventType || !sessionId) return;
    if (terminatedRef.current) return;
    void captureViolationFrames().then((frames) =>
      proctorApi
        .event(sessionId, { type: eventType, detail, ...frames })
        .then((res) => {
          const data = res.data as { warningCount: number; terminated: boolean };
          setState((p) => ({ ...p, warnings: data.warningCount }));
          if (data.terminated && !terminatedRef.current) {
            terminatedRef.current = true;
            try {
              onTerminatedRef.current?.();
            } catch (err) {
              console.warn('[proctor] onTerminated threw', err);
            }
          }
        })
        .catch((err) => {
          console.warn('[proctor] event POST failed', err);
        }),
    );
  };

  const applyVerdict = (next: LiveVerdict, detail: Record<string, unknown>) => {
    const now = Date.now();
    lastVerdictAtRef.current = now;

    if (next === 'OK' || next === 'PENDING') {
      // The grace-window sustain (NO_FACE / LOOK_AWAY / EYES_CLOSED before the
      // verdict has been confirmed) is owned by handleResult, which clears it
      // when conditions return to all-good. Here we only drop a sustain that
      // already fired so the next episode gets a fresh fire window.
      if (sustainRef.current?.fired) sustainRef.current = null;
      return;
    }
    const cur = sustainRef.current;
    const fireMs = SUSTAIN_FIRE_MS_BY_VERDICT[next] ?? DEFAULT_SUSTAIN_FIRE_MS;
    if (!cur || cur.verdict !== next) {
      sustainRef.current = { verdict: next, startedAt: now, fired: false };
    } else if (!cur.fired && now - cur.startedAt >= fireMs) {
      cur.fired = true;
      fireEvent(next, { ...detail, sustainedMs: now - cur.startedAt });
    }
  };

  /* ───────────────────────────── local detector loop ───────────────────────────── */
  const captureBitmap = async (): Promise<ImageBitmap | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    try {
      return await createImageBitmap(v);
    } catch {
      return null;
    }
  };

  const handleResult = (r: Extract<DetectorReply, { type: 'result' }>) => {
    const now = Date.now();
    let verdict: LiveVerdict = 'OK';
    const detail: Record<string, unknown> = {
      faceCount: r.faceCount,
      yaw: r.yaw,
      pitch: r.pitch,
      eyeOpenRatio: r.eyeOpenRatio,
      eyeYawDeg: r.eyeYawDeg,
      eyePitchDeg: r.eyePitchDeg,
      eyeGazeConfidence: r.eyeGazeConfidence,
    };

    if (r.faceCount === 0) {
      // Tolerate brief dropouts — only flip to NO_FACE after ≥1.5s of dropout.
      // Read previous verdict from stateRef (NOT closure-captured `state`):
      // this closure is bound once via worker.onmessage so `state` would be
      // frozen to 'PENDING' forever, defeating the grace-window hold.
      const prevVerdict = stateRef.current.verdict;
      const cur = sustainRef.current;
      if (cur?.verdict === 'NO_FACE' && now - cur.startedAt >= NO_FACE_MIN_MS) {
        verdict = 'NO_FACE';
      } else if (!cur || cur.verdict !== 'NO_FACE') {
        sustainRef.current = { verdict: 'NO_FACE', startedAt: now, fired: false };
        verdict = prevVerdict === 'OK' || prevVerdict === 'PENDING' ? 'OK' : prevVerdict;
      } else {
        verdict = prevVerdict; // hold previous verdict during the grace window
      }
    } else if (r.faceCount > 1) {
      verdict = 'MULTIPLE_FACES';
    } else {
      const yawBad = r.yaw != null && Math.abs(r.yaw) > YAW_LIMIT_DEG;
      const pitchBad = r.pitch != null && r.pitch < PITCH_DOWN_LIMIT_DEG;
      // Iris-based eye gaze — only trust above the confidence floor so
      // closed eyes / blurred frames don't false-fire.
      const eyeReliable =
        r.eyeGazeConfidence != null && r.eyeGazeConfidence >= EYE_GAZE_MIN_CONFIDENCE;
      const eyeYawBad =
        eyeReliable && r.eyeYawDeg != null && Math.abs(r.eyeYawDeg) > EYE_YAW_LIMIT_DEG;
      const eyePitchBad =
        eyeReliable &&
        r.eyePitchDeg != null &&
        (r.eyePitchDeg > EYE_PITCH_DOWN_LIMIT_DEG ||
          r.eyePitchDeg < EYE_PITCH_UP_LIMIT_DEG);
      if (yawBad || pitchBad || eyeYawBad || eyePitchBad) {
        if (eyeYawBad || eyePitchBad) {
          detail.eyeGazeBreach = {
            yawDeg: r.eyeYawDeg,
            pitchDeg: r.eyePitchDeg,
            confidence: r.eyeGazeConfidence,
          };
        }
        const cur = sustainRef.current;
        if (cur?.verdict === 'LOOK_AWAY' && now - cur.startedAt >= LOOK_AWAY_MIN_MS) {
          verdict = 'LOOK_AWAY';
        } else if (!cur || cur.verdict !== 'LOOK_AWAY') {
          sustainRef.current = { verdict: 'LOOK_AWAY', startedAt: now, fired: false };
        }
      } else if (r.eyeOpenRatio != null && r.eyeOpenRatio < EYE_OPEN_RATIO_THRESHOLD) {
        const cur = sustainRef.current;
        if (cur?.verdict === 'EYES_CLOSED' && now - cur.startedAt >= EYES_CLOSED_MIN_MS) {
          verdict = 'EYES_CLOSED';
        } else if (!cur || cur.verdict !== 'EYES_CLOSED') {
          sustainRef.current = { verdict: 'EYES_CLOSED', startedAt: now, fired: false };
        }
      } else {
        // Single face, looking forward, eyes open — drop any grace sustain that
        // hasn't yet escalated to a confirmed verdict.
        if (sustainRef.current && !sustainRef.current.fired) sustainRef.current = null;
      }
    }

    applyVerdict(verdict, detail);

    // Re-rendering the whole exam page 5×/sec made typing answers feel laggy.
    // Bin the high-rate telemetry to 5° steps and only setState when something
    // user-visible actually changed (verdict transition, face count change, or
    // a binned-angle shift). The exact yaw/pitch/eyeOpenRatio still pass into
    // setState when we do update — so the banner's running numbers stay live.
    const prev = stateRef.current;
    const bin = (v: number | null): number | null =>
      v == null ? null : Math.round(v / 5) * 5;
    const yawBinChanged = bin(prev.yaw) !== bin(r.yaw);
    const pitchBinChanged = bin(prev.pitch) !== bin(r.pitch);
    const verdictChanged = prev.verdict !== verdict;
    const faceCountChanged = prev.faceCount !== r.faceCount;
    const sourceChanged = prev.source !== 'LOCAL';
    if (verdictChanged || faceCountChanged || yawBinChanged || pitchBinChanged || sourceChanged) {
      setState((p) => ({
        ...p,
        verdict,
        faceCount: r.faceCount,
        yaw: r.yaw,
        pitch: r.pitch,
        roll: r.roll,
        eyeOpenRatio: r.eyeOpenRatio,
        detectorMs: r.detectorMs,
        source: 'LOCAL',
      }));
    }
    inFlightDetectRef.current = false;
    inFlightStartedAtRef.current = 0;
  };

  // A frame is "stuck" if the worker hasn't replied within this many ms.
  // tinyFaceDetector @ 224×224 normally takes 20–60 ms on WebGL / 100–250 ms
  // on CPU. 2 s is well past either ceiling, so resetting the flag means a
  // truly hung worker (model load failure mid-stream, GL context lost, etc.)
  // and not just a slow frame. Without this, one silent failure stalled
  // detection for the rest of the exam.
  const DETECT_WATCHDOG_MS = 2_000;

  const tickLocalDetect = async () => {
    if (!workerRef.current) return;
    if (inFlightDetectRef.current) {
      const stuckFor = Date.now() - inFlightStartedAtRef.current;
      if (stuckFor > DETECT_WATCHDOG_MS) {
        console.warn('[proctor] detector watchdog reset after', stuckFor, 'ms');
        inFlightDetectRef.current = false;
        inFlightStartedAtRef.current = 0;
      } else {
        return;
      }
    }
    const bitmap = await captureBitmap();
    if (!bitmap) return;
    inFlightDetectRef.current = true;
    inFlightStartedAtRef.current = Date.now();
    workerRef.current.postMessage(
      { type: 'detect', bitmap, ts: Date.now() } satisfies DetectorMessage,
      [bitmap],
    );
  };

  /* ───────────────────────────── server confirm (Rekognition) ───────────────────────────── */
  // Sync capture — kept for the demo's one-shot reference-face seed at start.
  // toDataURL is synchronous and blocks the main thread for 30–50 ms on a
  // 320×240 JPEG; that's fine once at start but unacceptable every 30 s.
  const captureBase64 = (): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7).split(',')[1] ?? null;
  };

  // Async capture for the periodic Rekognition / AI-review tick. Uses
  // OffscreenCanvas + convertToBlob (non-blocking JPEG encode) when
  // available; falls back to the sync path otherwise. Returns base64 with
  // no `data:` prefix. Quality 0.85 — high enough for clean evidence
  // images (admins reviewing cheating events need to see facial features
  // and any held objects clearly), and Gemini's 480×360 downscale
  // preserves most of that detail before model inference.
  const captureBase64Async = async (): Promise<string | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    if (typeof OffscreenCanvas === 'undefined') return captureBase64();
    try {
      const bitmap = await createImageBitmap(v);
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = c.getContext('2d');
      if (!ctx) {
        bitmap.close?.();
        return captureBase64();
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      const buf = await blob.arrayBuffer();
      // Chunked btoa avoids "Maximum call stack size exceeded" on large buffers.
      const u8 = new Uint8Array(buf);
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < u8.length; i += CHUNK) {
        bin += String.fromCharCode.apply(
          null,
          Array.from(u8.subarray(i, i + CHUNK)),
        );
      }
      return btoa(bin);
    } catch {
      return captureBase64();
    }
  };

  /* ───────────────────────────── live thumbnail (admin monitor) ───────────────────────────── */
  // Downscaled JPEG capture for the admin monitor live tile. Bumped from
  // 160×120 / q=0.5 (≈ 4 KB) to 240×ar / q=0.65 (≈ 14 KB) so admins can
  // actually identify the candidate's face and any prohibited objects in
  // the live feed instead of staring at a postage-stamp blur. Bandwidth
  // cost at 3 s cadence: ≈ 5 KB/s per candidate — still cheap. Larger
  // (full-resolution) frames are sent separately as evidence on AI flags.
  const captureThumbBase64 = async (): Promise<string | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const targetW = 240;
    const targetH = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * targetW));
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const bitmap = await createImageBitmap(v);
        const c = new OffscreenCanvas(targetW, targetH);
        const ctx = c.getContext('2d');
        if (!ctx) {
          bitmap.close?.();
          return null;
        }
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        bitmap.close?.();
        const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.65 });
        const buf = await blob.arrayBuffer();
        const u8 = new Uint8Array(buf);
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < u8.length; i += CHUNK) {
          bin += String.fromCharCode.apply(
            null,
            Array.from(u8.subarray(i, i + CHUNK)),
          );
        }
        return btoa(bin);
      } catch {
        /* fall through to sync path */
      }
    }
    const c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, targetW, targetH);
    return c.toDataURL('image/jpeg', 0.65).split(',')[1] ?? null;
  };

  const tickThumb = async () => {
    if (!sessionId) return;
    if (thumbInFlightRef.current) return;
    const b64 = await captureThumbBase64();
    if (!b64) return;
    thumbInFlightRef.current = true;
    try {
      await proctorApi.webcamThumb(sessionId, b64, Date.now());
    } catch (err) {
      // Soft-fail — admin monitor is non-critical to the exam.
      console.warn('[proctor] webcam thumb upload failed', err);
    } finally {
      thumbInFlightRef.current = false;
    }
  };

  /* ─────────────────── AI proctor tick (every aiReviewMs — 3s in the real exam) ─────────────────── */
  // Overlap-guard watchdog — slightly above the 20s axios timeout on
  // aiProctorApi.review so the timeout is what normally clears the guard;
  // the watchdog only rescues pathological hangs (e.g. a demo review fn
  // that never settles).
  const AI_REVIEW_INFLIGHT_MAX_MS = 25_000;

  const tickAiReview = async () => {
    if (!sessionId && !demoAiReviewFnRef.current) return;
    const inFlightSince = aiInFlightSinceRef.current;
    if (inFlightSince !== null) {
      const stuckFor = Date.now() - inFlightSince;
      if (stuckFor < AI_REVIEW_INFLIGHT_MAX_MS) return; // overlap guard
      console.warn('[proctor] ai-review watchdog: previous request stuck for', stuckFor, 'ms — proceeding');
    }
    const b64 = await captureBase64Async();
    if (!b64) return;
    const startedAt = Date.now();
    aiInFlightSinceRef.current = startedAt;
    const ts = startedAt;
    try {
      let res;
      if (sessionId) {
        const screenFrame = captureScreenEvidenceRef.current
          ? await captureScreenEvidenceRef.current()
          : (getLatestScreenFrameRef.current?.() ?? null);
        res = await aiProctorApi.review(sessionId, ts, b64, screenFrame?.b64 ?? null);
      } else {
        res = await demoAiReviewFnRef.current!(ts, b64);
      }
      const v = res.data.aiVerdict;
      if (v === 'LOW' || v === 'MED' || v === 'HIGH') {
        try {
          onAiVerdictRef.current?.(v, {
            captionKo: res.data.captionKo,
            captionEn: res.data.captionEn,
            ruleBroken: res.data.ruleBroken,
            evidenceUrl: res.data.evidenceUrl,
            frameBase64: b64,
          });
        } catch (err) {
          console.warn('[proctor] onAiVerdict threw', err);
        }
        const ai: LiveVerdict =
          v === 'LOW' ? 'AI_LOW' : v === 'MED' ? 'AI_MED' : 'AI_HIGH';
        setState((p) => ({ ...p, verdict: ai, source: 'SERVER' }));
      }
    } catch (err) {
      console.warn('[proctor] ai-review failed', err);
    } finally {
      // Only clear our own claim — if the watchdog let a newer request start
      // while this one was stuck, the late completion must not unlock it.
      if (aiInFlightSinceRef.current === startedAt) {
        aiInFlightSinceRef.current = null;
      }
    }
  };

  const tickServerConfirm = async () => {
    const b64 = await captureBase64Async();
    if (!b64) return;
    try {
      const res = await proctorApi.faceCheck(b64, { purpose, sessionId });
      const d = res.data as {
        verdict: 'OK' | 'NO_FACE' | 'MULTIPLE_FACES' | 'LOOK_AWAY' | 'EYES_CLOSED';
        faceCount: number;
        yaw: number | null;
        pitch: number | null;
        identityMatched?: boolean;
      };
      // Server is authoritative — if it disagrees with local OK, override and
      // skip the sustain window (a 30s confirmation has its own latency).
      const serverVerdict: LiveVerdict =
        d.verdict === 'OK' ? 'OK' : (d.verdict as LiveVerdict);

      if (serverVerdict !== 'OK') {
        const eventType = VERDICT_TO_EVENT[serverVerdict];
        if (eventType) {
          fireEvent(serverVerdict, { source: 'server-confirm', faceCount: d.faceCount });
        }
      }

      const identityMatched = d.identityMatched ?? null;
      // Only `false` (a confirmed Rekognition NO_MATCH) increments the streak.
      // `null` means INDETERMINATE / REVIEW / Rekognition error — those are
      // *not* signals of a different person, so the streak should stay where
      // it is (don't reset, don't escalate). Only `true` clears it.
      if (identityMatched === true) {
        identityMismatchStreakRef.current = 0;
      } else if (identityMatched === false) {
        identityMismatchStreakRef.current += 1;
        if (identityMismatchStreakRef.current >= IDENTITY_MISMATCH_REQUIRED_STREAK) {
          fireEvent('IDENTITY_MISMATCH', {
            source: 'server-confirm',
            streak: identityMismatchStreakRef.current,
          });
          identityMismatchStreakRef.current = 0;
        } else {
          console.log(
            '[proctor] identity mismatch streak',
            identityMismatchStreakRef.current,
            'of',
            IDENTITY_MISMATCH_REQUIRED_STREAK,
            '— waiting for confirmation',
          );
        }
      }

      setState((p) => ({
        ...p,
        // Don't overwrite a worse local verdict with OK — server is slower.
        verdict: serverVerdict !== 'OK' ? serverVerdict : p.verdict,
        lastConfirmedAt: Date.now(),
        identityMatched,
        source: 'SERVER',
      }));
    } catch (err) {
      console.warn('[proctor] server confirm failed', err);
    }
  };

  /* ───────────────────────────── lifecycle ───────────────────────────── */
  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }

    let cancelled = false;
    (async () => {
      await start();
      if (cancelled) return;

      const w = new Worker(new URL('./proctorDetector.worker.ts', import.meta.url), {
        type: 'module',
        name: 'proctor-detector',
      });
      workerRef.current = w;
      w.onmessage = (e: MessageEvent<DetectorReply>) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          console.log('[proctor] worker ready, tf backend =', msg.backend);
          setState((p) => ({ ...p, backend: msg.backend }));
          detectTimerRef.current = window.setInterval(tickLocalDetect, localDetectMs);
        } else if (msg.type === 'result') {
          handleResult(msg);
        } else if (msg.type === 'error') {
          console.warn('[proctor] worker error', msg.message);
          inFlightDetectRef.current = false;
          inFlightStartedAtRef.current = 0;
        }
      };
      w.postMessage({ type: 'init', modelUrl } satisfies DetectorMessage);

      // Server confirm cadence — first one after a short warmup so the camera
      // has time to expose properly.
      window.setTimeout(tickServerConfirm, 3_000);
      serverTimerRef.current = window.setInterval(tickServerConfirm, serverConfirmMs);

      // AI review cadence — runs when a sessionId is present (real exam) or
      // when a demoAiReviewFn is provided (demo mode).
      if (sessionId || demoAiReviewFn) {
        window.setTimeout(tickAiReview, 5_000);
        aiTimerRef.current = window.setInterval(tickAiReview, aiReviewMs);
      }

      // Live webcam thumbnail for the admin monitor — requires a sessionId
      // so we never send anonymous demo frames upstream.
      if (sessionId) {
        window.setTimeout(tickThumb, 4_000);
        thumbTimerRef.current = window.setInterval(tickThumb, thumbMs);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, serverConfirmMs, localDetectMs, aiReviewMs, thumbMs, modelUrl]);

  /* ── Ensure the stream stays attached to the <video> element ──
   * If the video element mounts AFTER `start()` has already acquired the
   * stream (e.g. the fullscreen-gate render path delayed mounting the
   * <ProctorLivePipPreview>), the stream sits in `streamRef` but has no
   * `<video>.srcObject` — captureBitmap then returns null forever. This
   * interval re-attaches as soon as both refs are available. */
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const v = videoRef.current;
      const s = streamRef.current;
      if (v && s && v.srcObject !== s) {
        v.srcObject = s;
        v.play().catch(() => {});
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [enabled]);

  /* ── Safety-net: release the camera on tab close / hard navigation ──
   * React's useEffect cleanup normally handles unmount on SPA navigation,
   * but it does NOT fire when the tab is closed, the browser is killed,
   * or when bfcache stores the page. The `pagehide` event is the spec-
   * recommended hook for releasing media devices in those cases — without
   * this, the OS-level camera indicator can stay on until the entire
   * browser process exits. */
  useEffect(() => {
    if (!enabled) return;
    const release = () => {
      try {
        stop();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pagehide', release);
    window.addEventListener('beforeunload', release);
    return () => {
      window.removeEventListener('pagehide', release);
      window.removeEventListener('beforeunload', release);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    state,
    videoRef,
    start,
    stop,
    captureFrameBase64: captureBase64,
    getMediaStream: () => streamRef.current,
  };
}

/**
 * Banner — same visual contract as the legacy ProctorBanner so existing exam
 * pages don't need style changes. Accepts either the new `ProctorLiveState`
 * or any subset that includes `verdict`/`faceCount`/`yaw`/`pitch`.
 */
export function ProctorLiveBanner({ state }: { state: ProctorLiveState }) {
  const { t } = useI18n();
  if (state.verdict === 'OK' || state.verdict === 'PENDING') return null;
  const messageKey = `pb.${state.verdict}` as const;
  const tone =
    state.verdict === 'ERROR' ||
    state.verdict === 'NO_FACE' ||
    state.verdict === 'MULTIPLE_FACES' ||
    state.verdict === 'IDENTITY_MISMATCH' ||
    state.verdict === 'AI_HIGH'
      ? 'bg-red-600'
      : 'bg-amber-600';
  return (
    <div
      className={`${tone} text-white text-xs px-4 py-1.5 flex items-center gap-3 font-medium`}
      role="alert"
    >
      <span className="font-bold uppercase">{t('pb.label')}</span>
      <span className="flex-1">{t(messageKey)}</span>
      <span className="opacity-80 font-mono">
        faces={state.faceCount ?? '?'} · yaw={state.yaw?.toFixed(0) ?? '?'} · pitch=
        {state.pitch?.toFixed(0) ?? '?'} · warn={state.warnings}/3
      </span>
    </div>
  );
}

const PIP_POS_STORAGE_KEY = 'axis:proctor-pip-pos';
const PIP_MARGIN = 12;
// 240×180 (4:3) on desktop, scaling down to at most 30% of the viewport width
// on narrow windows (min 128 so the face stays recognizable).
const PIP_MAX_W = 240;
const PIP_MIN_W = 128;

function pipWidth(viewportW: number): number {
  return Math.max(PIP_MIN_W, Math.min(PIP_MAX_W, Math.round(viewportW * 0.3)));
}

/**
 * Free position persisted as FRACTIONS of the draggable range (0 = left/top
 * edge, 1 = right/bottom edge) — pixel positions don't survive viewport
 * changes, fractions keep the tile in the same relative spot on any screen.
 */
interface PipPosFraction {
  fx: number;
  fy: number;
}

function readPipPos(): PipPosFraction {
  if (typeof window === 'undefined') return { fx: 1, fy: 1 };
  try {
    // localStorage (not session) — the placement must survive tab close and
    // the next exam/demo visit, and stay wherever the candidate dropped it.
    const raw = window.localStorage.getItem(PIP_POS_STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PipPosFraction>;
      if (typeof v.fx === 'number' && typeof v.fy === 'number') {
        return {
          fx: Math.max(0, Math.min(1, v.fx)),
          fy: Math.max(0, Math.min(1, v.fy)),
        };
      }
    }
  } catch {
    /* ignore */
  }
  // Default: bottom-right, same as the old corner-snap default.
  return { fx: 1, fy: 1 };
}

export function ProctorLivePipPreview({
  videoRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [pos, setPos] = useState<PipPosFraction>(readPipPos);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    // Real rendered size at drag start — the collapsed pill is much smaller
    // than pipW×pipH, so clamping must use what is actually on screen.
    w: number;
    h: number;
    pointerId: number;
  } | null>(null);
  const [livePos, setLivePos] = useState<{ left: number; top: number } | null>(null);
  // 접기/펴기 — 접으면 영상 숨기고 "proctor · live" 라벨만 있는 작은 박스로.
  const [collapsed, setCollapsed] = useState(false);
  // Viewport tracked in state so the tile re-clamps and re-scales on resize
  // (fullscreen enter/exit changes the viewport mid-exam).
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pipW = pipWidth(viewport.w);
  const pipH = Math.round(pipW * 0.75);
  // Draggable range — the span the fractional position maps onto.
  const rangeX = Math.max(0, viewport.w - pipW - PIP_MARGIN * 2);
  const rangeY = Math.max(0, viewport.h - pipH - PIP_MARGIN * 2);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Don't start a drag when interacting with controls inside the PiP.
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      w: rect.width,
      h: rect.height,
      pointerId: e.pointerId,
    };
    setLivePos({ left: rect.left, top: rect.top });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const left = Math.max(
      PIP_MARGIN,
      Math.min(window.innerWidth - drag.w - PIP_MARGIN, drag.originLeft + dx),
    );
    const top = Math.max(
      PIP_MARGIN,
      Math.min(window.innerHeight - drag.h - PIP_MARGIN, drag.originTop + dy),
    );
    setLivePos({ left, top });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    try {
      e.currentTarget.releasePointerCapture(drag.pointerId);
    } catch {
      /* ignore */
    }
    // Persist the EXACT drop point (no corner snapping) as range fractions so
    // the tile lands in the same relative spot after resize / fullscreen.
    const dropped = livePos ?? { left: drag.originLeft, top: drag.originTop };
    const next: PipPosFraction = {
      fx: rangeX > 0 ? Math.max(0, Math.min(1, (dropped.left - PIP_MARGIN) / rangeX)) : 1,
      fy: rangeY > 0 ? Math.max(0, Math.min(1, (dropped.top - PIP_MARGIN) / rangeY)) : 1,
    };
    setPos(next);
    try {
      window.localStorage.setItem(PIP_POS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    dragRef.current = null;
    setLivePos(null);
  };

  const style: React.CSSProperties = livePos
    ? { left: livePos.left, top: livePos.top }
    : {
        left: PIP_MARGIN + pos.fx * rangeX,
        top: PIP_MARGIN + pos.fy * rangeY,
      };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`fixed bg-black border border-gray-700 rounded shadow-lg overflow-hidden z-50 select-none touch-none ${
        collapsed ? 'w-auto h-9' : ''
      } ${livePos ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={collapsed ? style : { ...style, width: pipW, height: pipH }}
      role="region"
      aria-label="Proctor preview (drag to place it anywhere)"
      title="Drag to place anywhere"
    >
      {/* 접기/펴기 토글 — 우상단. 버튼이므로 onPointerDown 의 closest('button') 가드로
          드래그를 시작시키지 않는다. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand proctor preview' : 'Collapse proctor preview'}
        title={collapsed ? 'Expand' : 'Collapse'}
        className="absolute top-0.5 right-0.5 z-10 w-4 h-4 flex items-center justify-center rounded-sm bg-black/60 text-white leading-none hover:bg-black/80"
      >
        {collapsed ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      </button>

      {/* 영상은 접힘 여부와 무관하게 항상 마운트 — 언마운트하면 ref/스트림이 끊겨
          얼굴 인식·프레임 캡처(감독)가 멈춘다. 접힘 시엔 1px·투명으로 시각만 숨김. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={
          collapsed
            ? 'absolute w-px h-px opacity-0 pointer-events-none'
            : 'w-full h-full object-cover pointer-events-none'
        }
      />
      {collapsed ? (
        <div className="h-full flex items-center gap-2 pl-3 pr-7 text-[12px] text-white whitespace-nowrap w-50">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          proctor · live
        </div>
      ) : (
        <div className="absolute bottom-0 left-0 right-0 text-[9px] text-white bg-black/60 px-1 py-0.5 pointer-events-none flex items-center justify-between">
          <span>proctor · live</span>
          <Move aria-hidden className="w-3 h-3 opacity-70" />
        </div>
      )}
    </div>
  );
}
