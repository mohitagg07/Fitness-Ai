// VYRN — Weekly Performance
//
// Answers question 5 alongside Momentum, but at the "real numbers" level:
// sessions completed, total volume lifted, training time, and average
// RPE this week — GET /progress/weekly-stats, computed server-side from
// workout_sessions/exercise_logs. The highlight row surfaces the most
// recent real PR from GET /progress/pr-timeline. No client-side chart
// math or invented trend lines — if there's no data yet, the card shows
// an honest empty state instead of a fabricated graph.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';
import Divider from '../ui/Divider';
import { useWeeklyStats, usePrTimeline } from '../../hooks/useDashboardQueries';

interface PR { date: string; lift: string; weight_kg: number; reps: number; }

function formatTime(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// PERF: previously a bare useEffect fetch that ran once per mount, with
// no cache — every time this card remounted (e.g. React Navigation
// dropping the Home tab's screen from memory and rebuilding it) it
// re-fetched both endpoints from zero, and there was no way for it to
// show anything until that finished. useWeeklyStats/usePrTimeline share
// the app-wide query cache: on a warm return to this tab the numbers
// render immediately from cache while a background refetch quietly
// confirms they're still current (staleTime: 60s — see queryKeys.ts).
function WeeklyPerformanceCard() {
  const { data: stats } = useWeeklyStats();
  const { data: prData } = usePrTimeline(1);
  const latestPR: PR | null = prData?.has_data ? prData.prs[0] : null;

  if (!stats || !stats.has_data) {
    return (
      <View style={styles.card}>
        <SectionLabel label="WEEKLY PERFORMANCE" icon="stats-chart" color={COLORS.recoveryBlue} />
        <Text variant="body" color={COLORS.textMuted} numberOfLines={2} style={{ lineHeight: 19 }}>
          Complete a workout this week to see your volume, training time, and intensity here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <SectionLabel
        label="WEEKLY PERFORMANCE"
        icon="stats-chart"
        color={COLORS.recoveryBlue}
        actionLabel="Analytics"
        onAction={() => router.push('/(tabs)/progress')}
      />

      <View style={styles.statsGrid}>
        <Stat label="Sessions" value={`${stats.sessions_completed}`} />
        <Divider direction="vertical" style={{ height: 36 }} />
        <Stat label="Volume" value={`${Math.round(stats.total_volume_kg)}kg`} />
        <Divider direction="vertical" style={{ height: 36 }} />
        <Stat label="Time" value={formatTime(stats.total_minutes)} />
        <Divider direction="vertical" style={{ height: 36 }} />
        <Stat label="Avg RPE" value={stats.avg_rpe ? stats.avg_rpe.toFixed(1) : '—'} />
      </View>

      {latestPR && (
        <View style={styles.prRow}>
          <View style={styles.prIcon}>
            <Ionicons name="trophy" size={14} color={COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color={COLORS.textMuted} numberOfLines={1}>LATEST PR · {latestPR.date}</Text>
            <Text variant="body" weight="bold" numeric color={COLORS.text} numberOfLines={1}>
              {latestPR.lift} — {latestPR.weight_kg}kg × {latestPR.reps}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="h2" numeric color={COLORS.text}>{value}</Text>
      <Text variant="caption" color={COLORS.textSecondary} style={{ fontSize: 10 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.cardBorder, padding: SPACING.xl,
  },
  statsGrid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stat: { alignItems: 'center', gap: 3, flex: 1 },
  prRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginTop: SPACING.lg, paddingTop: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.cardBorder,
  },
  prIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.cardElevated,
    alignItems: 'center', justifyContent: 'center',
  },
});

export default React.memo(WeeklyPerformanceCard);