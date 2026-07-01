// VYRN — Dashboard loading skeleton
//
// Replaces the old center-screen spinner. A spinner tells the user
// "wait"; a skeleton tells them "here's what's coming" — it mimics the
// real card layout (rings, workout card, decision card) so the first
// paint feels instant and nothing jumps around when real data lands.

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { COLORS } from '../../theme/colors';

function Shimmer({ style }: { style: any }) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.75, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[style, { opacity }]} />;
}

export default function DashboardSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Shimmer style={styles.logoBlock} />
        <Shimmer style={styles.nameBlock} />
      </View>

      {/* Rings */}
      <View style={styles.ringsRow}>
        <Shimmer style={styles.ring} />
        <Shimmer style={styles.ring} />
      </View>

      {/* Workout card */}
      <Shimmer style={styles.bigCard} />

      {/* Decision card */}
      <Shimmer style={styles.bigCard} />

      {/* Mini rings */}
      <View style={styles.miniRow}>
        <Shimmer style={styles.miniRing} />
        <Shimmer style={styles.miniRing} />
        <Shimmer style={styles.miniRing} />
      </View>
    </View>
  );
}

const BASE = '#141414';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingTop: 60, paddingHorizontal: 16 },
  header: { marginBottom: 24, gap: 10 },
  logoBlock: { width: 80, height: 20, borderRadius: 6, backgroundColor: BASE },
  nameBlock: { width: 160, height: 26, borderRadius: 6, backgroundColor: BASE },
  ringsRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginBottom: 28 },
  ring: { width: 150, height: 150, borderRadius: 75, backgroundColor: BASE },
  bigCard: { height: 120, borderRadius: 18, backgroundColor: BASE, marginBottom: 14 },
  miniRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 8 },
  miniRing: { width: 64, height: 64, borderRadius: 32, backgroundColor: BASE },
});
