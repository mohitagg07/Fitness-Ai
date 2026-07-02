// VYRN — Achievements
//
// Built entirely from the real workout_streak the dashboard already
// pulls from GET /api/dashboard/summary — no invented numbers. XP and
// the milestone ladder are the same disclosed client-side gamification
// layer MomentumCard uses (streak * 15 XP, milestones every 7/14/30/60/
// 100 days), not a claim about anything the backend tracked.
//
// Renders nothing below a 1-day streak — an "achievement" card for a
// streak of zero would just be noise on a fresh account.

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';
import ProgressBar from '../ui/ProgressBar';

const MILESTONES = [
  { days: 7, title: 'Iron Discipline', xp: 100 },
  { days: 14, title: 'Unbreakable', xp: 250 },
  { days: 30, title: 'Forged in Fire', xp: 500 },
  { days: 60, title: 'Relentless', xp: 1000 },
  { days: 100, title: 'Legendary', xp: 2000 },
];

function currentAndNext(streak: number) {
  let current: typeof MILESTONES[number] | null = null;
  let next = MILESTONES[0];
  for (const m of MILESTONES) {
    if (streak >= m.days) { current = m; } else { next = m; break; }
  }
  if (current && streak >= MILESTONES[MILESTONES.length - 1].days) next = current;
  return { current, next };
}

export default function AchievementCard({ workoutStreak }: { workoutStreak: number }) {
  const sparkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(sparkle, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sparkle, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  if (workoutStreak < 1) return null;

  const { current, next } = currentAndNext(workoutStreak);
  const prevThreshold = current?.days ?? 0;
  const pct = ((workoutStreak - prevThreshold) / Math.max(1, next.days - prevThreshold)) * 100;
  const unlockedBadges = MILESTONES.filter((m) => workoutStreak >= m.days);
  const sparkleOpacity = sparkle.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <View style={styles.card}>
      <SectionLabel label="ACHIEVEMENTS" icon="trophy" color={COLORS.gold} />

      {current ? (
        <View style={styles.currentRow}>
          <Animated.View style={[styles.badgeWrap, { opacity: sparkleOpacity }]}>
            <Ionicons name="trophy" size={22} color={COLORS.gold} />
          </Animated.View>
          <View style={{ flex: 1 }}>
            <Text variant="cardTitle" color={COLORS.gold}>{current.title}</Text>
            <Text variant="caption" color={COLORS.textSecondary}>{current.days} Day Workout Streak</Text>
          </View>
          <Text variant="body" weight="bold" numeric color={COLORS.gold}>+{current.xp} XP</Text>
        </View>
      ) : (
        <Text variant="body" color={COLORS.textSecondary} style={{ marginBottom: SPACING.sm }}>
          You're {next.days - workoutStreak} days from your first achievement.
        </Text>
      )}

      <View style={styles.progressRow}>
        <Text variant="caption" color={COLORS.textMuted}>NEXT · {next.title}</Text>
        <Text variant="caption" weight="bold" numeric color={COLORS.text}>{workoutStreak}/{next.days}</Text>
      </View>
      <ProgressBar progress={pct} color={COLORS.gold} />

      {unlockedBadges.length > 0 && (
        <View style={styles.badgeRow}>
          {unlockedBadges.map((b) => (
            <View key={b.days} style={styles.miniBadge}>
              <Ionicons name="star" size={14} color={COLORS.gold} />
            </View>
          ))}
          <Text
            variant="caption" color={COLORS.textMuted}
            onPress={() => router.push('/(tabs)/profile')}
            style={styles.tapToView}
          >
            {unlockedBadges.length} unlocked · Tap to view all
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    backgroundColor: '#14100A', borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: alpha(COLORS.gold, 0.25), padding: SPACING.lg,
  },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  badgeWrap: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: alpha(COLORS.gold, 0.14),
    alignItems: 'center', justifyContent: 'center',
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md },
  miniBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: alpha(COLORS.gold, 0.12),
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: alpha(COLORS.gold, 0.3),
  },
  tapToView: { marginLeft: 'auto', fontSize: 11 },
});
