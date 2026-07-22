const REASONING_WHEEL_GESTURE_GAP_MS = 500;

export type ReasoningEncoderControl = "encoder-cw" | "encoder-ccw";

export function reasoningControlForWheelEvent(
  previousEventAt: number | undefined,
  eventAt: number,
  deltaY: number,
): ReasoningEncoderControl | undefined {
  if (deltaY === 0) return undefined;
  if (previousEventAt !== undefined) {
    const gap = eventAt - previousEventAt;
    if (gap >= 0 && gap < REASONING_WHEEL_GESTURE_GAP_MS) return undefined;
  }
  return deltaY < 0 ? "encoder-cw" : "encoder-ccw";
}
