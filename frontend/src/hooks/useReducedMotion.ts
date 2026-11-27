import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Central OS Reduce Motion preference.
 * Motion is disabled until the native preference has been read so the first
 * frame never animates against a user's accessibility setting.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (active) setReduced(enabled); })
      .catch(() => { if (active) setReduced(false); });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
