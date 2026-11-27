/**
 * VYRN motion language.
 * Fast tactile feedback; slower, quiet entrances. Avoid continuous decorative
 * motion on data screens so movement always communicates a state change.
 */
export const MOTION = {
  pressScale: 0.975,
  pressSpeed: 42,
  pressReleaseSpeed: 34,
  entranceDuration: 280,
  entranceDistance: 10,
  staggerStep: 42,
  expandDuration: 220,
} as const;
