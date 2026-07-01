import React, { useEffect, useState } from 'react';
import { Text, TextStyle } from 'react-native';
export default function CountUpNumber({
  value, duration = 900, style, suffix = '', decimals = 0,
}: {
  value: number; duration?: number; style?: TextStyle | TextStyle[]; suffix?: string; decimals?: number;
}) {
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    let startTs: number | null = null;
    let raf: number;
    const tick = (ts: number) => {
      if (!startTs) startTs = ts;
      const progress = Math.min((ts - startTs) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplayed(ease * value);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <Text style={style}>
      {displayed.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}
      {suffix}
    </Text>
  );
}
