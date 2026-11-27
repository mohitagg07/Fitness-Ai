import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * App-wide Reduce Motion preference.
 *
 * One native AccessibilityInfo subscription is shared by every animated
 * component. This avoids installing a native event listener for each card,
 * button, ring, and list row as screens mount and unmount.
 */
let reducedMotion = true;
let initialized = false;
const listeners = new Set<() => void>();

function publish(next: boolean) {
  if (reducedMotion === next) return;
  reducedMotion = next;
  listeners.forEach((listener) => listener());
}

function initialize() {
  if (initialized) return;
  initialized = true;

  AccessibilityInfo.isReduceMotionEnabled()
    .then(publish)
    .catch(() => publish(false));

  try {
    AccessibilityInfo.addEventListener('reduceMotionChanged', publish);
  } catch {
    // Older/web accessibility implementations may not expose this event.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  initialize();
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return reducedMotion;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
