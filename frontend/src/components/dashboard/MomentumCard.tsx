// VYRN — Momentum
//
// Answers question 5: "Am I improving?" Real streak counters (from the
// same dashboard summary), real weekly session count (GET
// /progress/weekly-stats), and a real GitHub-style heatmap built from
// actual completed sessions (GET /progress/heatmap) — never a randomly
// generated grid.
//
// XP/Level is the one deliberately-labeled exception: there is no
// backend XP system, so this is an explicit, disclosed client-side
// gamification layer computed directly from the real workout streak
// (streak * 15 XP, level = floor(xp / 500) + 1) — not a claim about
// anything the backend tracked, and never presented as an AI metric.

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { analyticsApi } from '../../utils/api';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';
import ProgressBar from '../ui/ProgressBar';
import Divider from '../ui/Divider';

interface HeatCell { date: string; sets: number; has_session: boolean; future: boolean; }

interface Props {
  workoutStreak: number;
  proteinStreak: number;
  weeklySessions: number | null;
}

const XP_PER_STREAK_DAY = 15;
const XP_PER_LEVEL = 500;
// Streak milestones the app celebrates — mirrors the pattern the old
// per-card achievement logic used (7 / 14 / 30 / 60 / 100 days).
const MILESTONES = [7, 14, 30, 60, 100];
function nextMilestone(streak: number) {
  return MILESTONES.find((m) => m > streak) ?? MILESTONES[MILESTONES.length - 1];
}

function heatColor(cell: HeatCell) {
  if (cell.future) return 'transparent';
  if (!cell.has_session) return COLORS.cardElevated;
  if (cell.sets >= 15) return COLORS.primaryGreen;
  if (cell.sets >= 8) return alpha(COLORS.primaryGreen, 0.65);
  return alpha(COLORS.primaryGreen, 0.35);
}

export default function MomentumCard({ workoutStreak, proteinStreak, weeklySessions }: Props) {
  const [heatmap, setHeatmap] = useState<HeatCell[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await analyticsApi.getHeatmap(4);
        if (!cancelled && res.data?.has_data) setHeatmap(res.data.weeks);
      } catch {
        // Fails quiet — the streak/consistency stats above still render.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const xp = workoutStreak * XP_PER_STREAK_DAY;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = xp % XP_PER_LEVEL;
  const milestone = nextMilestone(workoutStreak);
  const weeklyPct = weeklySessions !== null ? Math.min(100, (weeklySessions / 7) * 100) : 0;

  return (
    <View style={styles.card}>
      <SectionLabel label="YOUR MOMENTUM" icon="trending-up" color={COLORS.primaryGreen} />

      <View style={styles.statsRow}>
        <StreakStat icon="flame" color={COLORS.gold} label="Workout" value={workoutStreak} />
        <Divider direction="vertical" style={{ height: 40 }} />
        <StreakStat icon="nutrition" color={COLORS.protein} label="Protein" value={proteinStreak} />
      </View>

      <View style={styles.milestoneBlock}>
        <View style={styles.milestoneRow}>
          <Text variant="caption" color={COLORS.textMuted}>NEXT MILESTONE</Text>
          <Text variant="caption" weight="bold" numeric color={COLORS.text}>{workoutStreak}/{milestone} days</Text>
        </View>
        <ProgressBar progress={(workoutStreak / milestone) * 100} color={COLORS.gold} />
      </View>

      {weeklySessions !== null && (
        <View style={styles.milestoneBlock}>
          <View style={styles.milestoneRow}>
            <Text variant="caption" color={COLORS.textMuted}>WEEKLY CONSISTENCY</Text>
            <Text variant="caption" weight="bold" numeric color={COLORS.text}>{weeklySessions}/7</Text>
          </View>
          <ProgressBar progress={weeklyPct} color={COLORS.primaryGreen} />
        </View>
      )}

      <View style={styles.milestoneBlock}>
        <View style={styles.milestoneRow}>
          <Text variant="caption" color={COLORS.textMuted}>LEVEL {level}</Text>
          <Text variant="caption" weight="bold" numeric color={COLORS.text}>{xpIntoLevel}/{XP_PER_LEVEL} XP</Text>
        </View>
        <ProgressBar progress={(xpIntoLevel / XP_PER_LEVEL) * 100} color={COLORS.recoveryBlue} />
      </View>

      {heatmap && (
        <View style={styles.heatmapBlock}>
          <Text variant="caption" color={COLORS.textMuted} style={{ marginBottom: SPACING.sm }}>LAST 4 WEEKS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.heatmapGrid}>
              {heatmap.map((week, wi) => (
                <View key={wi} style={styles.heatmapCol}>
                  {week.map((cell, di) => (
                    <View key={di} style={[styles.heatCell, { backgroundColor: heatColor(cell) }]} />
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function StreakStat({ icon, color, label, value }: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; value: number }) {
  return (
    <View style={styles.streakStat}>
      <View style={styles.streakTopRow}>
        <Ionicons name={icon} size={18} color={color} />
        <Text variant="h1" numeric color={COLORS.text}>{value}</Text>
      </View>
      <Text variant="caption" color={COLORS.textSecondary}>{label} Streak</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.cardBorder, padding: SPACING.lg,
  },
  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    marginBottom: SPACING.lg, paddingBottom: SPACING.lg,
    borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder,
  },
  streakStat: { alignItems: 'center', gap: 4 },
  streakTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  milestoneBlock: { marginBottom: SPACING.md },
  milestoneRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  heatmapBlock: { marginTop: SPACING.sm },
  heatmapGrid: { flexDirection: 'row', gap: 3 },
  heatmapCol: { gap: 3 },
  heatCell: { width: 12, height: 12, borderRadius: 3 },
});
