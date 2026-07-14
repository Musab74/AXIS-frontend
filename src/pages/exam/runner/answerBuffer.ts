/**
 * Local answer buffer — a crash/network safety net for the exam runner.
 *
 * Every structured answer is mirrored to localStorage the moment it changes, so
 * a dropped connection, a tab crash or an accidental reload cannot destroy work
 * the server has not accepted yet (the CBT specs require a "네트워크 단절 대비
 * 로컬 버퍼").
 *
 * The SERVER stays authoritative: on load we only restore a buffered answer when
 * the server has nothing for that task, and the buffer is cleared on submit.
 * Optimistic-concurrency `version` values are never buffered — a stale version
 * would 409 forever.
 *
 * Modelled on src/pages/info/inquiryNoticeSeen.ts (the project's persisted-map idiom).
 */
const KEY = (sessionId: string) => `axis.exam.buffer.${sessionId}`;

type Buffer = Record<string, string>; // taskId -> contentText

function read(sessionId: string): Buffer {
  try {
    const raw = localStorage.getItem(KEY(sessionId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Buffer) : {};
  } catch {
    return {};
  }
}

/** Mirror one task's answer. Never throws — a full quota must not break the exam. */
export function bufferAnswer(sessionId: string, taskId: string, contentText: string): void {
  try {
    const buf = read(sessionId);
    buf[taskId] = contentText;
    localStorage.setItem(KEY(sessionId), JSON.stringify(buf));
  } catch {
    /* quota / private mode — the exam continues, we just lose the safety net */
  }
}

/**
 * Answers to restore: buffered entries for tasks the SERVER returned empty.
 * A server answer always wins — it is the one that will actually be graded.
 */
export function recoverAnswers(
  sessionId: string,
  serverText: Record<string, string>,
): Record<string, string> {
  const buf = read(sessionId);
  const out: Record<string, string> = {};
  for (const [taskId, text] of Object.entries(buf)) {
    if (text && !(serverText[taskId] ?? '').trim()) out[taskId] = text;
  }
  return out;
}

export function clearBuffer(sessionId: string): void {
  try {
    localStorage.removeItem(KEY(sessionId));
  } catch {
    /* ignore */
  }
}
