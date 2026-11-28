// Named steps that took long, as User Timing measures ("spc …"), so that a measurement
// (e2e/responsive.spec.ts) can say which step a long task or a long frame was. Only steps
// of SPAN_MS or more are recorded: nothing piles up in normal use.

export const SPAN_MS = 15;

/** Runs `fn`; when it took SPAN_MS or more, records it as the measure "spc <name>". */
export function span<T>(name: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const t1 = performance.now();
    if (t1 - t0 >= SPAN_MS) performance.measure(`spc ${name}`, { start: t0, end: t1 });
  }
}
