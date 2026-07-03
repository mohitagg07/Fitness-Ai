// VYRN — Muscle Recovery Map
//
// A colored front-view body diagram: each region is shaded by
// GET /api/progress/muscle-recovery, which derives recovery_pct from real
// exercise_logs timestamps (services/training_load_engine.
// compute_muscle_recovery_map) — hours since a muscle group was last
// trained, ramped against a standard recovery window. Green >=80%,
// yellow 40-79%, red <40%, gray = no data yet for that group.
//
// This is a simplified anatomical silhouette, not a medical illustration —
// six flat regions (chest/shoulders/arms/core/legs/back-proxied-via-arms)
// are enough to answer "what's ready to train today" at a glance, which is
// the whole point of the roadmap ask.

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import Svg, { Path, Circle, Ellipse } from 'react-native-svg';
import api from '../../utils/api';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';

interface MuscleGroupRecovery {
  name: string;
  recovery_pct: number | null;
  hours_since_trained: number | null;
  status: 'green' | 'yellow' | 'red' | 'no_data';
}

const STATUS_COLOR: Record<string, string> = {
  green: COLORS.recoveryHigh,
  yellow: COLORS.recoveryMed,
  red: COLORS.recoveryLow,
  no_data: '#2A2A2A',
};

export default function MuscleRecoveryMap() {
  const [groups, setGroups] = useState<MuscleGroupRecovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/progress/muscle-recovery');
        if (!cancelled) {
          setGroups(res.data.muscle_groups || []);
          setHasData(!!res.data.has_data);
        }
      } catch {
        // Fails quiet — the rest of the Recovery tab still renders.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const colorFor = (name: string) => {
    const g = groups.find((x) => x.name === name);
    return g ? STATUS_COLOR[g.status] : STATUS_COLOR.no_data;
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={COLORS.recoveryHigh} size="small" style={{ marginVertical: 20 }} />
      </View>
    );
  }

  if (!hasData) return null;

  return (
    <View style={styles.card}>
      <SectionLabel label="MUSCLE RECOVERY MAP" icon="body-outline" color={COLORS.recoveryHigh} />
      <View style={styles.bodyRow}>
        <Svg viewBox="0 0 200 340" width={140} height={238}>
          {/* Head (neutral, not a trainable group) */}
          <Circle cx="100" cy="28" r="20" fill="#232323" />
          {/* Shoulders */}
          <Ellipse cx="58" cy="72" rx="22" ry="16" fill={colorFor('Shoulders')} />
          <Ellipse cx="142" cy="72" rx="22" ry="16" fill={colorFor('Shoulders')} />
          {/* Chest */}
          <Path d="M70 58 Q100 48 130 58 L130 118 Q100 132 70 118 Z" fill={colorFor('Chest')} />
          {/* Core */}
          <Path d="M74 118 Q100 128 126 118 L120 178 Q100 188 80 178 Z" fill={colorFor('Core')} />
          {/* Arms */}
          <Path d="M40 78 Q30 130 38 178 L56 174 Q52 126 60 84 Z" fill={colorFor('Arms')} />
          <Path d="M160 78 Q170 130 162 178 L144 174 Q148 126 140 84 Z" fill={colorFor('Arms')} />
          {/* Legs */}
          <Path d="M80 182 Q76 250 72 310 L94 310 Q98 250 98 182 Z" fill={colorFor('Legs')} />
          <Path d="M120 182 Q124 250 128 310 L106 310 Q102 250 102 182 Z" fill={colorFor('Legs')} />
        </Svg>

        <View style={styles.legend}>
          {groups.map((g) => (
            <View key={g.name} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[g.status] }]} />
              <Text variant="body" color={COLORS.text} style={{ flex: 1 }}>{g.name}</Text>
              <Text variant="caption" weight="bold" numeric color={STATUS_COLOR[g.status]}>
                {g.recovery_pct != null ? `${g.recovery_pct}%` : '—'}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.cardBorder, padding: SPACING.lg,
  },
  bodyRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg, marginTop: SPACING.sm },
  legend: { flex: 1, gap: SPACING.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
