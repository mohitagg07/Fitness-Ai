// VYRN — Trajectory
//
// Answers "what result can I expect?" using only what the backend can
// actually back up: real week-over-week strength deltas (GET
// /review/weekly → strength_gains, computed from personal_records/
// exercise_logs) and the coach's own forward-looking strategy narrative
// for next week. Deliberately does NOT show "Bench 100kg in 22 days"
// style day-count projections — nothing server-side computes that, and
// inventing a timeline client-side would be exactly the kind of
// fabricated number the rest of this app goes out of its way to avoid.

import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { reviewApi } from '../../utils/api';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';

interface StrengthGain { exercise: string; prev_kg: number; curr_kg: number; delta_kg: number; }

export default function PredictionCard() {
  const [gains, setGains] = useState<StrengthGain[]>([]);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await reviewApi.getWeekly();
        if (!cancelled && !res.data?.error) {
          setGains(res.data.strength_gains || []);
          setStrategy(res.data.next_week_strategy || null);
        }
      } catch {
        // Fails quiet.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loaded && gains.length === 0 && !strategy) return null;

  return (
    <View style={styles.card}>
      <SectionLabel label="TRAJECTORY" icon="trending-up" color={COLORS.strainGlow} />
      {gains.map((g, i) => (
        <View key={i} style={styles.gainRow}>
          <View style={styles.gainIcon}>
            <Ionicons name="arrow-up" size={13} color={COLORS.recoveryHigh} />
          </View>
          <Text variant="body" color={COLORS.text} style={{ flex: 1 }}>{g.exercise}</Text>
          <Text variant="body" weight="bold" numeric color={COLORS.recoveryHigh}>
            {g.prev_kg}kg → {g.curr_kg}kg
          </Text>
        </View>
      ))}
      {strategy && (
        <View style={styles.strategyBlock}>
          <Text variant="caption" color={COLORS.textMuted} style={{ marginBottom: 4 }}>NEXT WEEK'S STRATEGY</Text>
          <Text variant="body" color={COLORS.textSecondary} style={{ lineHeight: 20 }}>{strategy}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.cardBorder, padding: SPACING.lg,
  },
  gainRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  gainIcon: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: alpha(COLORS.recoveryHigh, 0.14),
    alignItems: 'center', justifyContent: 'center',
  },
  strategyBlock: {
    marginTop: SPACING.sm, paddingTop: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.cardBorder,
  },
});
