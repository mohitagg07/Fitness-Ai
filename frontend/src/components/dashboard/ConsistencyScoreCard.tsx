// VYRN — Consistency Score
//
// The most-requested feature from real user research: "instead of endless
// charts, just tell me if I've been consistent, and if not, why." This
// card is the single-number, single-sentence answer — everything else on
// the dashboard is still here for people who want to dig in, but this is
// the one thing meant to be understood in under two seconds.
//
// Backed by backend/agents/consistency_agent.py. Missing a day or two
// never reads as "failure" here on purpose — see that file's docstring
// for the reasoning. `data` comes from mission/today's `consistency`
// block when available; falls back to its own fetch (same shape) so the
// card still works on the older dashboard/summary fallback path.
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { progressApi } from '../../utils/api';
import { COLORS } from '../../theme/colors';
import { RADIUS, SPACING } from '../../theme/spacing';
import { ELEVATION } from '../../theme/layout';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';
import ProgressBar from '../ui/ProgressBar';

interface Pillar {
  label: string;
  pct: number;
  status: 'favorable' | 'slipping' | 'no_data';
  detail: string;
}

interface ConsistencyData {
  status: 'new' | 'scored';
  score: number;
  headline: string;
  mood?: string | null;
  pillars: Pillar[];
}

interface Props {
  data?: ConsistencyData | null;
}

const MOOD_EMOJI: Record<string, string> = {
  great: '🔥', good: '🙂', okay: '😐', bad: '😩',
};

function scoreColor(score: number) {
  if (score >= 80) return COLORS.recoveryHigh;
  if (score >= 55) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

function pillarColor(status: Pillar['status']) {
  if (status === 'favorable') return COLORS.recoveryHigh;
  if (status === 'no_data') return COLORS.textMuted;
  return COLORS.recoveryLow;
}

function ConsistencyScoreCard({ data: initialData }: Props) {
  const [data, setData] = useState<ConsistencyData | null | undefined>(initialData);
  const [loading, setLoading] = useState(!initialData);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await progressApi.getConsistency();
        if (!cancelled) setData(res.data);
      } catch {
        // Fails quiet — this card just doesn't render rather than showing
        // a broken/zeroed score.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initialData]);

  if (loading || !data) return null;

  if (data.status === 'new') {
    return (
      <View style={styles.card}>
        <SectionLabel label="CONSISTENCY" icon="pulse" color={COLORS.strain} />
        <Text variant="body" color={COLORS.textSecondary} style={{ marginTop: SPACING.xs }}>
          {data.headline}
        </Text>
      </View>
    );
  }

  const color = scoreColor(data.score);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <SectionLabel label="CONSISTENCY" icon="pulse" color={COLORS.strain} />
        {!!data.mood && <Text style={styles.moodEmoji}>{MOOD_EMOJI[data.mood] ?? ''}</Text>}
      </View>

      <View style={styles.scoreRow}>
        <Text variant="hero" numeric weight="bold" color={color} style={styles.scoreText}>
          {data.score}
        </Text>
        <Text variant="body" color={COLORS.textMuted} style={styles.scoreOutOf}>/ 100</Text>
      </View>

      <Text variant="body" color={COLORS.text} style={styles.headline}>
        {data.headline}
      </Text>

      <View style={styles.pillars}>
        {data.pillars.map((p) => (
          <View key={p.label} style={styles.pillarRow}>
            <View style={styles.pillarLabelRow}>
              <Ionicons
                name={p.status === 'favorable' ? 'checkmark-circle' : p.status === 'no_data' ? 'help-circle' : 'alert-circle'}
                size={14}
                color={pillarColor(p.status)}
              />
              <Text variant="caption" weight="semibold" color={COLORS.textSecondary}>{p.label}</Text>
            </View>
            <ProgressBar
              progress={p.status === 'no_data' ? 0 : p.pct}
              color={pillarColor(p.status)}
              style={styles.bar}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.cardBorder,
    padding: SPACING.lg, marginBottom: SPACING.md,
    ...ELEVATION.card,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moodEmoji: { fontSize: 18 },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: SPACING.sm },
  scoreText: { fontSize: 42, lineHeight: 46 },
  scoreOutOf: { marginLeft: 4, marginBottom: 6 },
  headline: { marginTop: SPACING.xs, marginBottom: SPACING.md, lineHeight: 20 },
  pillars: { gap: SPACING.sm },
  pillarRow: { gap: 4 },
  pillarLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bar: { height: 6, borderRadius: 3 },
});

export default React.memo(ConsistencyScoreCard);
