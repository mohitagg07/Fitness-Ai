// VYRN — "Since Yesterday" (morning-briefing step 4)
//
// Answers one question: what changed? Reuses the same ai_decisions rows
// TodaysDecisionCard already persists (one row per day, saved idempotently
// via POST /decisions/save) — no new backend endpoint needed. We just ask
// for the last 2 and diff them: confidence delta, any evidence signal that
// flipped favorable/unfavorable or moved in value, plus the streak counters
// already present in the dashboard summary.
//
// Fails quiet: if there's no decision from yesterday yet (new user, gap day)
// the card simply doesn't render rather than showing a misleading "no change".

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { decisionsApi } from '../../utils/api';
import { COLORS } from '../../theme/colors';

interface Signal { label: string; value: string; favorable: boolean; }
interface DecisionRow {
  id: string;
  decision: string;
  confidence_pct: number;
  created_at?: string;
  signals: Signal[];
}

interface ChangeLine {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  positive: boolean | null; // null = neutral
}

function diffSignals(today: Signal[], yesterday: Signal[]): ChangeLine[] {
  const lines: ChangeLine[] = [];
  const yMap = new Map(yesterday.map((s) => [s.label, s]));
  for (const t of today) {
    const y = yMap.get(t.label);
    if (!y) continue;
    if (y.value !== t.value) {
      lines.push({
        icon: t.favorable && !y.favorable ? 'trending-up' : (!t.favorable && y.favorable ? 'trending-down' : 'swap-horizontal'),
        text: `${t.label}: ${y.value} → ${t.value}`,
        positive: t.favorable === y.favorable ? null : t.favorable,
      });
    }
  }
  return lines.slice(0, 3);
}

export default function SinceYesterdayCard({
  workoutStreak, proteinStreak,
}: { workoutStreak?: number; proteinStreak?: number }) {
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<ChangeLine[]>([]);
  const [confidenceDelta, setConfidenceDelta] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await decisionsApi.list(2);
        const rows: DecisionRow[] = res.data?.decisions || [];
        if (rows.length >= 2 && !cancelled) {
          const [today, yesterday] = rows;
          setConfidenceDelta(today.confidence_pct - yesterday.confidence_pct);
          setLines(diffSignals(today.signals || [], yesterday.signals || []));
        }
      } catch {
        // Fail quiet — this card is supplementary, never blocks the dashboard.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;

  const hasStreakNews = (workoutStreak ?? 0) > 0 || (proteinStreak ?? 0) > 0;
  const hasAnything = lines.length > 0 || confidenceDelta !== null || hasStreakNews;
  if (!hasAnything) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
        <Text style={styles.headerLabel}>SINCE YESTERDAY</Text>
      </View>

      {confidenceDelta !== null && confidenceDelta !== 0 && (
        <View style={styles.line}>
          <Ionicons
            name={confidenceDelta > 0 ? 'arrow-up-circle' : 'arrow-down-circle'}
            size={15}
            color={confidenceDelta > 0 ? COLORS.recoveryHigh : COLORS.recoveryLow}
          />
          <Text style={styles.lineText}>
            Decision confidence {confidenceDelta > 0 ? 'up' : 'down'} {Math.abs(confidenceDelta)}%
          </Text>
        </View>
      )}

      {lines.map((l, i) => (
        <View key={i} style={styles.line}>
          <Ionicons
            name={l.icon}
            size={15}
            color={l.positive === null ? COLORS.textSecondary : l.positive ? COLORS.recoveryHigh : COLORS.recoveryLow}
          />
          <Text style={styles.lineText}>{l.text}</Text>
        </View>
      ))}

      {workoutStreak != null && workoutStreak > 0 && (
        <View style={styles.line}>
          <Ionicons name="flame" size={15} color={COLORS.recoveryMed} />
          <Text style={styles.lineText}>{workoutStreak}-day workout streak, still alive</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  headerLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineText: { color: COLORS.textSecondary, fontSize: 13, flex: 1 },
});
