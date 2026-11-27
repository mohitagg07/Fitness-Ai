import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../../store';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import { useMissionSummary, useRefreshDashboard } from '../../hooks/useDashboardQueries';
import { describeApiError } from '../../utils/api';
import { COLORS, alpha, recoveryColor } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import ProfileAvatar from '../shared/ProfileAvatar';
import AmbientGlow from '../shared/AmbientGlow';
import PressableScale from '../ui/PressableScale';

interface DashboardSummary {
  mission_text?: string;
  next_task?: string;
  workout_today?: {
    type?: string | null;
    rescheduled?: boolean;
    message?: string;
  };
  recovery?: {
    score?: number;
    score_pct?: number;
    action?: string;
    message?: string;
  };
  motivation_message?: string;
  proactive_brief?: {
    coach_message?: string;
  };
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function ReadinessDial({ score, color }: { score: number | null; color: string }) {
  const size = 98;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.stopAnimation();
    const target = score === null ? 0 : Math.max(0, Math.min(100, score));
    if (reduceMotion) {
      progress.setValue(target);
      return undefined;
    }
    const animation = Animated.timing(progress, {
      toValue: target,
      duration: 580,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, score, reduceMotion]);

  const dashOffset = progress.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
  });

  return (
    <View style={styles.dial}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={COLORS.border}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset as any}
          strokeLinecap="round"
          fill="none"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.dialCenter}>
        <Text style={styles.dialScore}>{score === null ? '—' : Math.round(score)}</Text>
        <Text style={styles.dialOutOf}>/ 100</Text>
      </View>
    </View>
  );
}

function QuickAction({
  icon,
  title,
  subtitle,
  accent,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <PressableScale style={styles.quickAction} onPress={onPress}>
      <View style={[styles.quickIcon, { backgroundColor: alpha(accent, 0.12), borderColor: alpha(accent, 0.22) }]}>
        <Ionicons name={icon} size={19} color={accent} />
      </View>
      <View style={styles.quickCopy}>
        <Text style={styles.quickTitle}>{title}</Text>
        <Text style={styles.quickSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="arrow-forward" size={17} color={COLORS.textMuted} />
    </PressableScale>
  );
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const responsive = useResponsiveLayout();
  const user = useStore((state) => state.user);
  const profile = useStore((state) => state.profile);

  const { data: summary, isPending, error, isRefetching } = useMissionSummary() as {
    data?: DashboardSummary;
    isPending: boolean;
    error: unknown;
    isRefetching: boolean;
  };
  const refreshDashboard = useRefreshDashboard();

  const firstName = user?.full_name?.split(' ')[0] || profile?.full_name?.split(' ')[0] || 'Athlete';
  const rawScore = typeof summary?.recovery?.score_pct === 'number'
    ? summary.recovery.score_pct
    : typeof summary?.recovery?.score === 'number'
      ? summary.recovery.score * 10
      : null;
  const score = rawScore === null ? null : Math.max(0, Math.min(100, rawScore));
  const scoreColor = score === null ? COLORS.textMuted : recoveryColor(score);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const workoutType = summary?.workout_today?.type?.trim() || null;
  const coachMessage = summary?.proactive_brief?.coach_message
    || summary?.motivation_message
    || summary?.mission_text
    || null;
  const errorMessage = error ? describeApiError(error).message : null;

  const onRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    await refreshDashboard();
  }, [refreshDashboard]);

  if (errorMessage && !summary) {
    return (
      <View style={[styles.errorScreen, { paddingTop: insets.top + 24 }]}>
        <View style={styles.errorIcon}>
          <Ionicons name="cloud-offline-outline" size={23} color={COLORS.textSecondary} />
        </View>
        <Text style={styles.errorTitle}>Your day is waiting.</Text>
        <Text style={styles.errorBody}>{errorMessage}</Text>
        <PressableScale style={styles.retryButton} onPress={() => void refreshDashboard()}>
          <Ionicons name="refresh" size={16} color={COLORS.background} />
          <Text style={styles.retryText}>Try again</Text>
        </PressableScale>
      </View>
    );
  }

  const readinessHeadline = score === null
    ? 'Building your baseline'
    : score >= 67
      ? 'Ready to train'
      : score >= 34
        ? 'Keep the intensity measured'
        : 'Recovery comes first';

  const readinessMessage = summary?.recovery?.message
    || (summary?.recovery?.action === 'check_in'
      ? 'Log a recovery check-in to build a reliable readiness picture.'
      : summary?.recovery?.action)
    || 'Log a few workouts and recovery check-ins to build your personal readiness picture.';

  return (
    <View style={styles.root}>
      <AmbientGlow variant="recovery" recoveryScore0to100={score ?? undefined} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 12,
            paddingBottom: Math.max(insets.bottom, 12) + 30,
            paddingHorizontal: responsive.gutter,
            maxWidth: responsive.pageMaxWidth,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={COLORS.primaryGreen}
            progressBackgroundColor={COLORS.card}
          />
        }
      >
        <View style={styles.topline}>
          <View>
            <Text style={styles.brandName}>VYRN</Text>
            <Text style={styles.brandSub}>YOUR PERSONAL PERFORMANCE SPACE</Text>
          </View>
          <ProfileAvatar size={42} onPress={() => router.push('/(tabs)/profile')} />
        </View>

        <View style={styles.pageHeading}>
          <Text style={styles.pageEyebrow}>HOME</Text>
          <Text style={styles.pageTitle}>Today.</Text>
          <Text style={styles.dateLabel}>{dateLabel.toUpperCase()}</Text>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.name}>{firstName}.</Text>
          <Text style={styles.greetingSub}>A clear plan. One good session at a time.</Text>
        </View>

        <View style={styles.readinessPanel}>
          <LinearGradient
            colors={[COLORS.cardElevated, COLORS.card, COLORS.backgroundTop]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View pointerEvents="none" style={styles.readinessAura} />
          <View style={styles.readinessTopline}>
            <View style={styles.readinessLabelRow}>
              <Ionicons name="pulse-outline" size={15} color={COLORS.primaryGreen} />
              <Text style={styles.eyebrow}>READINESS</Text>
            </View>
            <View style={[styles.livePill, { borderColor: alpha(scoreColor, 0.42) }]}>
              <View style={[styles.liveDot, { backgroundColor: scoreColor }]} />
              <Text style={[styles.liveText, { color: scoreColor }]}>
                {score === null ? (isPending ? 'SYNCING' : 'NEEDS DATA') : score >= 67 ? 'READY' : score >= 34 ? 'MODERATE' : 'RECOVER'}
              </Text>
            </View>
          </View>
          <View style={styles.readinessBody}>
            <View style={styles.readinessCopy}>
              <Text style={styles.readinessHeadline}>{readinessHeadline}</Text>
              <Text style={styles.readinessDescription} numberOfLines={4}>{readinessMessage}</Text>
              <Text style={styles.readinessFootnote}>BASED ON YOUR TRACKED DATA</Text>
            </View>
            <ReadinessDial score={score} color={scoreColor} />
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionEyebrow}>YOUR PLAN</Text>
            <Text style={styles.sectionTitle}>Today's session</Text>
          </View>
          {summary?.workout_today?.rescheduled ? (
            <Text style={styles.rescheduledLabel}>RESCHEDULED</Text>
          ) : null}
        </View>

        <View style={styles.trainingPanel}>
          <View style={styles.trainingIcon}>
            <Ionicons name="barbell-outline" size={24} color={COLORS.primaryGreen} />
          </View>
          <View style={styles.trainingCopy}>
            <Text style={styles.trainingLabel}>SCHEDULED WORKOUT</Text>
            <Text style={styles.trainingName}>{workoutType || 'No workout scheduled'}</Text>
            <Text style={styles.trainingDetail} numberOfLines={2}>
              {summary?.workout_today?.message
                || summary?.next_task
                || (workoutType ? 'Your session is ready when you are.' : 'Open training to build or start a session.')}
            </Text>
          </View>
        </View>

        <PressableScale
          style={styles.primaryButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
            router.push('/(tabs)/workout');
          }}
        >
          <LinearGradient
            colors={[COLORS.primaryGreen, '#B4ED4A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <Text style={styles.primaryButtonText}>{workoutType ? 'Open workout' : 'Plan a workout'}</Text>
          <Ionicons name="arrow-forward" size={18} color={COLORS.background} />
        </PressableScale>

        {coachMessage ? (
          <View style={styles.coachPanel}>
            <View style={styles.coachPanelTop}>
              <View style={styles.coachIcon}>
                <Ionicons name="sparkles" size={17} color={COLORS.coachPurple} />
              </View>
              <Text style={styles.coachLabel}>A NOTE FROM VYRN</Text>
              <PressableScale onPress={() => router.push('/(tabs)/coach')} style={styles.coachAction}>
                <Text style={styles.coachActionText}>ASK COACH</Text>
                <Ionicons name="arrow-forward" size={13} color={COLORS.coachPurple} />
              </PressableScale>
            </View>
            <Text style={styles.coachMessage} numberOfLines={4}>{coachMessage}</Text>
          </View>
        ) : null}

        <View style={styles.quickActions}>
          <QuickAction
            icon="nutrition-outline"
            title="Log food"
            subtitle="Track today's nutrition"
            accent={COLORS.carbs}
            onPress={() => router.push({ pathname: '/(tabs)/progress', params: { tab: 'nutrition' } } as any)}
          />
          <QuickAction
            icon="stats-chart-outline"
            title="See progress"
            subtitle="Body, recovery and trends"
            accent={COLORS.strain}
            onPress={() => router.push('/(tabs)/progress')}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  content: { width: '100%', alignSelf: 'center', gap: 0 },
  topline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  brandName: {
    color: COLORS.text,
    fontFamily: FONTS.numericBold,
    fontSize: 16,
    letterSpacing: 4.8,
  },
  brandSub: {
    color: COLORS.textMuted,
    fontFamily: FONTS.semibold,
    fontSize: 8,
    letterSpacing: 1.05,
    marginTop: 3,
  },
  pageHeading: { marginBottom: 24 },
  pageEyebrow: {
    color: COLORS.primaryGreen,
    fontFamily: FONTS.bold,
    fontSize: 10,
    letterSpacing: 1.8,
    marginBottom: 3,
  },
  pageTitle: {
    color: COLORS.text,
    fontFamily: FONTS.numericBold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.9,
    marginBottom: 17,
  },
  dateLabel: {
    color: COLORS.textMuted,
    fontFamily: FONTS.semibold,
    fontSize: 9,
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  greeting: { color: COLORS.textSecondary, fontFamily: FONTS.medium, fontSize: 17, lineHeight: 23 },
  name: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 44, lineHeight: 50, letterSpacing: -1.9 },
  greetingSub: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 18, marginTop: 5 },
  readinessPanel: {
    borderRadius: 28,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 19,
    marginBottom: 27,
    overflow: 'hidden',
  },
  readinessAura: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    top: -112,
    right: -74,
    backgroundColor: alpha(COLORS.primaryGreen, 0.075),
    borderWidth: 1,
    borderColor: alpha(COLORS.primaryGreen, 0.12),
  },
  readinessTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  readinessLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eyebrow: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 1.45 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 0.9 },
  readinessBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 19 },
  readinessCopy: { flex: 1, paddingRight: 2 },
  readinessHeadline: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 20, lineHeight: 25, letterSpacing: -0.35, marginBottom: 6 },
  readinessDescription: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 16 },
  readinessFootnote: { color: COLORS.textDim, fontFamily: FONTS.semibold, fontSize: 7, letterSpacing: 0.75, marginTop: 11 },
  dial: { width: 98, height: 98, alignItems: 'center', justifyContent: 'center' },
  dialCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  dialScore: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 27, lineHeight: 31, letterSpacing: -0.8 },
  dialOutOf: { color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 8, letterSpacing: 0.5, marginTop: -1 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 },
  sectionEyebrow: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.35 },
  sectionTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 21, lineHeight: 27, letterSpacing: -0.4, marginTop: 3 },
  rescheduledLabel: { color: COLORS.warning, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 0.8, marginBottom: 5 },
  trainingPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 16,
    borderRadius: 23,
    backgroundColor: COLORS.cardElevated,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    marginBottom: 10,
  },
  trainingIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: alpha(COLORS.primaryGreen, 0.12),
    borderWidth: 1,
    borderColor: alpha(COLORS.primaryGreen, 0.2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  trainingCopy: { flex: 1, minWidth: 0 },
  trainingLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.15, marginBottom: 4 },
  trainingName: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 17, lineHeight: 22 },
  trainingDetail: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15, marginTop: 4 },
  primaryButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: COLORS.primaryGreen,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginBottom: 25,
  },
  primaryButtonText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 13, letterSpacing: 0.15 },
  coachPanel: { borderRadius: 23, padding: 17, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, marginBottom: 18 },
  coachPanelTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  coachIcon: { width: 30, height: 30, borderRadius: 11, backgroundColor: alpha(COLORS.coachPurple, 0.14), alignItems: 'center', justifyContent: 'center' },
  coachLabel: { color: COLORS.textSecondary, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.05, flex: 1 },
  coachAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  coachActionText: { color: COLORS.coachPurple, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 0.65 },
  coachMessage: { color: COLORS.text, fontFamily: FONTS.medium, fontSize: 13, lineHeight: 20 },
  quickActions: { gap: 9 },
  quickAction: {
    minHeight: 65,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardElevated,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  quickIcon: { width: 40, height: 40, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  quickCopy: { flex: 1 },
  quickTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 12 },
  quickSubtitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, marginTop: 3 },
  errorScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, paddingHorizontal: 28 },
  errorIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  errorTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 22, textAlign: 'center', marginBottom: 8 },
  errorBody: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 19, textAlign: 'center', marginBottom: 22 },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 19, paddingVertical: 13, borderRadius: 15, backgroundColor: COLORS.primaryGreen },
  retryText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 12 },
});
