// VYRN — Trend Projection
//
// Real ordinary-least-squares regression over logged bodyweight and your
// most-trained lift (GET /progress/predictions/trajectory →
// services/prediction_engine.py) — not an LLM guessing a number. Every
// projection shows its confidence (derived from R² and sample size) so a
// noisy trend reads as noisy rather than a fabricated certainty.

import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../utils/api';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';

interface TrendBlock {
  has_data: boolean;
  reason?: string;
  n_points?: number;
  weekly_rate?: number;
  unit?: string;
  r_squared?: number;
  confidence?: 'Low' | 'Medium' | 'High';
  last_actual?: number;
  projections?: { weeks: number; value: number; unit: string }[];
}

const CONFIDENCE_COLOR: Record<string, string> = {
  High: COLORS.recoveryHigh,
  Medium: COLORS.recoveryMed,
  Low: COLORS.recoveryLow,
};

function TrendRow({ title, trend, valueLabel }: { title: string; trend: TrendBlock; valueLabel: string }) {
  if (!trend.has_data) {
    return (
      <View style={styles.block}>
        <Text variant="cardTitle" color={COLORS.text}>{title}</Text>
        <Text variant="caption" color={COLORS.textMuted} style={{ marginTop: 4 }}>
          {trend.reason || 'Not enough data yet.'}
        </Text>
      </View>
    );
  }

  const direction = (trend.weekly_rate || 0) >= 0 ? 'up' : 'down';
  const confColor = CONFIDENCE_COLOR[trend.confidence || 'Low'];

  return (
    <View style={styles.block}>
      <View style={styles.blockHeader}>
        <Text variant="cardTitle" color={COLORS.text}>{title}</Text>
        <View style={[styles.confBadge, { borderColor: alpha(confColor, 0.4) }]}>
          <Text variant="caption" weight="bold" color={confColor}>{trend.confidence} confidence</Text>
        </View>
      </View>
      <Text variant="body" color={COLORS.textSecondary} style={{ marginTop: 4 }}>
        {valueLabel}: {trend.last_actual}{trend.unit} — trending {direction} {Math.abs(trend.weekly_rate || 0)}{trend.unit}/week
      </Text>
      {trend.projections && trend.projections.length > 0 && (
        <View style={styles.projRow}>
          {trend.projections.map((p) => (
            <View key={p.weeks} style={styles.projItem}>
              <Text variant="caption" color={COLORS.textMuted}>{p.weeks}w</Text>
              <Text variant="body" weight="bold" numeric color={COLORS.text}>{p.value}{p.unit}</Text>
            </View>
          ))}
        </View>
      )}
      <Text variant="caption" color={COLORS.textMuted} style={{ marginTop: 6 }}>
        Based on {trend.n_points} logged points, R²={trend.r_squared}. A straight-line projection — real
        progress isn't linear, treat this as a trend, not a promise.
      </Text>
    </View>
  );
}

export default function TrendProjectionCard() {
  const [bodyweight, setBodyweight] = useState<TrendBlock | null>(null);
  const [lift, setLift] = useState<(TrendBlock & { exercise_name?: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/progress/predictions/trajectory');
        if (!cancelled) {
          setBodyweight(res.data.bodyweight);
          setLift(res.data.lift);
        }
      } catch {
        // Fails quiet.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (!bodyweight?.has_data && !lift?.has_data) return null;

  return (
    <View style={styles.card}>
      <SectionLabel label="TREND PROJECTION" icon="analytics-outline" color={COLORS.strainGlow} />
      {lift && (
        <TrendRow
          title={lift.exercise_name || 'Top lift'}
          trend={lift}
          valueLabel="Current best"
        />
      )}
      {bodyweight && (
        <TrendRow title="Bodyweight" trend={bodyweight} valueLabel="Current" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.cardBorder, padding: SPACING.lg,
  },
  block: { marginTop: SPACING.md },
  blockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  confBadge: { borderWidth: 1, borderRadius: RADIUS.pill ?? 999, paddingHorizontal: 8, paddingVertical: 2 },
  projRow: { flexDirection: 'row', gap: SPACING.lg, marginTop: SPACING.sm },
  projItem: { alignItems: 'center' },
});
