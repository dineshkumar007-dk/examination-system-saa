// Wall-clock changes must not pause or extend an active examination countdown.
export function createExamClock(
  serverTime,
  deadline,
  monotonic = () => performance.now(),
) {
  if (!Number.isFinite(serverTime) || !Number.isFinite(deadline))
    throw new Error("Invalid examination deadline.");
  const anchor = monotonic();
  return {
    remaining: () =>
      Math.max(
        0,
        Math.ceil((deadline - serverTime - (monotonic() - anchor)) / 1000),
      ),
  };
}
