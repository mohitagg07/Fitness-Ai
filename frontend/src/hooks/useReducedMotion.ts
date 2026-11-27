import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

type Listener = (enabled: boolean) => void;

const listeners = new Set<Listener>();
// Be conservative until Android/iOS has returned its system preference.
let currentValue = true;
let started = false;

function publish(enabled: boolean) {
  if (currentValue === enabled) return;
  currentValue = enabled;
  listeners.forEach((listener) => listener(enabled));
}

function startListening() {
  if (started) return;
  started = true;

  AccessibilityInfo.isReduceMotionEnabled()
    .then(publish)
    .catch(() => publish(false));

  AccessibilityInfo.addEventListener('reduceMotionChanged', publish);
}

/**
 * Shared OS Reduce Motion preference.
 * One native subscription is shared across the whole component tree.
 */
export function useReducedMotion(): boolean {
  const [enabled, setEnabled] = useState(currentValue);

  useEffect(() => {
    listeners.add(setEnabled);
    startListening();
    setEnabled(currentValue);
    return () => {
      listeners.delete(setEnabled);
    };
  }, []);

  return enabled;
}
