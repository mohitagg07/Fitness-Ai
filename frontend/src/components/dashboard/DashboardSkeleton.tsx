// VYRN — Lightweight Home placeholder.
// Static surfaces avoid running several independent shimmer loops while
// the first mission query is loading. The actual Home shell renders as soon
// as the route mounts, so this remains a fallback rather than the normal path.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { COLORS } from '../../theme/colors';

export default function DashboardSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.logo} />
        <View style={styles.avatar} />
      </View>
      <View style={styles.heading}>
        <View style={styles.eyebrow} />
        <View style={styles.title} />
        <View style={styles.greeting} />
      </View>
      <View style={styles.readiness}>
        <View style={styles.line} />
        <View style={styles.readinessBody}>
          <View style={styles.copy}>
            <View style={styles.lineWide} />
            <View style={styles.lineShort} />
            <View style={styles.lineShort} />
          </View>
          <View style={styles.ring} />
        </View>
      </View>
      <View style={styles.card} />
      <View style={styles.button} />
      <View style={styles.cardSmall} />
    </View>
  );
}

const SURFACE = COLORS.cardElevated;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, paddingTop: 62, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 30 },
  logo: { width: 112, height: 21, borderRadius: 6, backgroundColor: SURFACE },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: SURFACE },
  heading: { marginBottom: 25, gap: 9 },
  eyebrow: { width: 46, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  title: { width: 110, height: 30, borderRadius: 8, backgroundColor: SURFACE },
  greeting: { width: 185, height: 38, borderRadius: 8, backgroundColor: SURFACE },
  readiness: { padding: 18, borderRadius: 26, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, marginBottom: 26 },
  line: { width: 95, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  readinessBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  copy: { flex: 1, gap: 9 },
  lineWide: { width: '82%', height: 16, borderRadius: 5, backgroundColor: SURFACE },
  lineShort: { width: '70%', height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  ring: { width: 88, height: 88, borderRadius: 44, backgroundColor: SURFACE },
  card: { height: 100, borderRadius: 22, backgroundColor: SURFACE, marginBottom: 11 },
  button: { height: 54, borderRadius: 18, backgroundColor: COLORS.cardElevated, marginBottom: 24 },
  cardSmall: { height: 86, borderRadius: 20, backgroundColor: SURFACE },
});
