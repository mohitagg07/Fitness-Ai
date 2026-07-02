// AchievementCard — VYRN
//
// "Iron Discipline" streak card from the Home-screen design brief.
// Built entirely from the real workout_streak the dashboard already
// pulls from GET /api/dashboard/summary — no invented numbers. XP and
// the milestone ladder are a client-side gamification layer on top of
// that real count (streak * 15 XP, milestones every 7 days), not a
// claim about anything the backend tracked, so it's labeled as what it
// is rather than presented as an AI-derived metric.
//
// Renders nothing below a 1-day streak — an "achievement" card for a
// streak of zero would just be noise on a fresh account.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS, EYEBROW, BODY } from '../../theme/typography';
import { SPACING, RADIUS } from '../../theme/spacing';

const XP_PER_DAY = 15;
const MILESTONE_STEP = 7; // next milestone is always the next multiple of 7

interface Props {
  streak: number;
}

export default function AchievementCard({ streak }: Props) {
  const barWidth = useRef(new Animated.Value(0)).current;

  const nextMilestone = Math.ceil((streak + (streak % MILESTONE_STEP === 0 ? 1 : 0)) / MILESTONE_STEP) * MILESTONE_STEP;
  const progressIntoStep = streak % MILESTONE_STEP === 0 && streak > 0 ? MILESTONE_STEP : streak % MILESTONE_STEP;
  const pct = Math.min(1, progressIntoStep / MILESTONE_STEP);
  const xp = streak * XP_PER_DAY;

  useEffect(() => {
    Animated.timing(barWidth, {
      toValue: pct,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct]);

  if (!streak || streak < 1) return null;

  const widthPct = barWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="trophy" size={13} color={COLORS.gold} />
        <Text style={styles.eyebrow}>ACHIEVEMENT UNLOCKED</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.badge}>
          <Ionicons name="flame" size={26} color={COLORS.gold} />
        </View>
        <View style={styles.info}>
          <Text style={styles.title}>Iron Discipline</Text>
          <Text style={styles.subtitle}>{streak} Day Workout Streak</Text>
          <Text style={styles.xp}>+{xp} XP</Text>
        </View>
      </View>

      <View style={styles.progressRow}>
        <Text style={styles.milestoneLabel}>Next Milestone · {nextMilestone} Days</Text>
        <Text style={styles.milestoneCount}>{streak} / {nextMilestone}</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width: widthPct }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: alpha(COLORS.gold, 0.28),
    padding: SPACING.lg,
    // soft gold glow, consistent with how the readiness tiles use
    // shadowColor for their own accent glow elsewhere in this screen
    shadowColor: COLORS.gold,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.md },
  eyebrow: { ...EYEBROW, color: COLORS.gold, fontSize: 11 },
  body: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.lg },
  badge: {
    width: 56, height: 56, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: alpha(COLORS.gold, 0.12),
    borderWidth: 1, borderColor: alpha(COLORS.gold, 0.35),
  },
  info: { flex: 1 },
  title: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 18, marginBottom: 2 },
  subtitle: { ...BODY, color: COLORS.textSecondary, fontSize: 13, marginBottom: 4 },
  xp: { color: COLORS.gold, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 13 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs },
  milestoneLabel: { ...BODY, color: COLORS.textSecondary, fontSize: 11 },
  milestoneCount: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontVariant: ['tabular-nums'], fontSize: 11 },
  track: { height: 6, borderRadius: 3, backgroundColor: COLORS.cardElevated, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: COLORS.gold },
});