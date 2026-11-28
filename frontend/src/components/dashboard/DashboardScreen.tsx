import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  ImageBackground,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../../store';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import { useMissionSummary, useRefreshDashboard } from '../../hooks/useDashboardQueries';
import { describeApiError, recoveryApi } from '../../utils/api';
import { COLORS, alpha, recoveryColor } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import ProfileAvatar from '../shared/ProfileAvatar';
import AmbientGlow from '../shared/AmbientGlow';
import PressableScale from '../ui/PressableScale';
import RecoveryCheckInModal, { RecoveryCheckInValues } from './RecoveryCheckInModal';
import ProgramEvolutionCard from './ProgramEvolutionCard';

interface DashboardSummary {
  mission?: string;
  mission_text?: string;
  next_task?: string;
  intensity?: string;
  training_time?: {
    period?: string | null;
    label?: string;
    display_label?: string | null;
    source?: string;
    is_exact?: boolean;
    note?: string;
  };
  workout_today?: {
    type?: string | null;
    rescheduled?: boolean;
    message?: string;
  };
  recovery?: {
    score?: number | null;
    score_pct?: number | null;
    action?: string;
    message?: string;
  };
  nutrition_status?: {
    calories_remaining?: number;
    protein_remaining_g?: number;
    water_remaining_ml?: number;
  };
  motivation_message?: string;
  proactive_brief?: {
    coach_message?: string;
    todays_focus?: string;
    recommendation?: string;
    why_summary?: string;
    suggested_top_set?: string | null;
  };

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
      <View style={[styles.quickIcon, { backgroundColor: alpha(accent, 0.14), borderColor: alpha(accent, 0.28) }]}>
        <Ionicons name={icon} size={21} color={accent} />
      </View>
      <View style={styles.quickCopy}>
        <Text style={styles.quickTitle}>{title}</Text>
        <Text style={styles.quickSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.quickArrow}>
        <Ionicons name="arrow-up-right-box" size={16} color={COLORS.textSecondary} />
      </View>
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
  const [recoveryCheckInVisible, setRecoveryCheckInVisible] = useState(false);
  const [savingRecoveryCheckIn, setSavingRecoveryCheckIn] = useState(false);
  const [existingRecoveryCheckIn, setExistingRecoveryCheckIn] = useState<RecoveryCheckInValues | null>(null);

  useEffect(() => {
    let alive = true;
    recoveryApi.getTodayCheckIn()
      .then((response) => {
        if (alive) setExistingRecoveryCheckIn(response.data?.check_in || null);
      })
      .catch(() => {
        // Unavailable storage remains unavailable; profile defaults are not substituted.
      });
    return () => { alive = false; };
  }, []);

  const saveRecoveryCheckIn = async (values: RecoveryCheckInValues) => {
    if (savingRecoveryCheckIn) return;
    setSavingRecoveryCheckIn(true);
    try {
      const response = await recoveryApi.saveTodayCheckIn(values);
      setExistingRecoveryCheckIn(response.data?.check_in || values);
      setRecoveryCheckInVisible(false);
      await refreshDashboard();
    } catch (saveError) {
      Alert.alert(
        'Recovery check-in not saved',
        describeApiError(saveError).message,
      );
    } finally {
      setSavingRecoveryCheckIn(false);
    }
  };

  const firstName = user?.full_name?.split(' ')[0] || profile?.full_name?.split(' ')[0] || 'Athlete';
  const rawScore = typeof summary?.recovery?.score_pct === 'number'
    ? summary.recovery.score_pct
    : typeof summary?.recovery?.score === 'number'
      ? summary.recovery.score * 10
      : null;
  const score = rawScore === null ? null : Math.max(0, Math.min(100, rawScore));
  const scoreColor = score === null ? COLORS.textMuted : recoveryColor(score);

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

  const readinessHeadline = summary?.recovery?.action === 'check_in'
    ? 'Log recovery details'
    : score === null
      ? 'Building your baseline'
      : score >= 67
        ? 'Ready to train'
        : score >= 34
          ? 'Keep the intensity measured'
          : 'Recovery comes first';

  const readinessMessage = summary?.recovery?.message
    || summary?.recovery?.action
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
          <View style={styles.homeHeading}>
            <Text style={styles.brandSub}>YOUR TRAINING SPACE</Text>
            <Text style={styles.brandName}>Today</Text>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
          </View>
          <ProfileAvatar size={44} onPress={() => router.push('/(tabs)/profile')} />
        </View>

        {/* Training photo: Redd Francisco on Unsplash, free under the Unsplash License. */}
        <ImageBackground
          source={{ uri: 'https://images.unsplash.com/photo-1709315957145-a4bad1feef28?auto=format&fit=crop&w=1200&q=85' }}
          resizeMode="cover"
          style={styles.heroCard}
          imageStyle={styles.heroImage}
          accessibilityLabel="Athlete training with a barbell in a dark gym"
        >
          <LinearGradient
            colors={['rgba(5,9,13,0.12)', 'rgba(5,9,13,0.52)', 'rgba(5,9,13,0.97)']}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.heroContent}>
            <View style={styles.heroTopline}>
              <View style={styles.heroEyebrow}>
                <View style={styles.heroLiveDot} />
                <Text style={styles.heroEyebrowText}>TODAY'S COACH PLAN</Text>
              </View>
              <View style={styles.heroStatus}>
                <Text style={styles.heroStatusText}>
                  {score === null ? 'BUILDING BASELINE' : score >= 67 ? 'READY' : score >= 34 ? 'MEASURED' : 'RECOVER'}
                </Text>
              </View>
            </View>

            <View style={styles.heroCopy}>
              <Text style={styles.heroKicker}>THE PRIORITY</Text>
              <Text style={styles.heroTitle}>
                {summary?.recovery?.action === 'rest'
                  ? 'Recovery day.'
                  : summary?.mission
                    ? summary.mission
                    : workoutType
                      ? `${workoutType.replace(/_/g, ' ')} day.`
                      : 'Build your training plan.'}
              </Text>
              <Text style={styles.heroDescription} numberOfLines={3}>
                {summary?.proactive_brief?.todays_focus
                  || summary?.proactive_brief?.recommendation
                  || summary?.workout_today?.message
                  || 'Your coach is reviewing your training history and readiness.'}
              </Text>
            </View>

            <View style={styles.heroMetaRow}>
              <View style={styles.heroMeta}>
                <Ionicons name="time-outline" size={16} color={COLORS.primaryGreen} />
                <View style={styles.heroMetaCopy}>
                  <Text style={styles.heroMetaLabel}>PREFERRED WINDOW</Text>
                  <Text style={styles.heroMetaValue}>
                    {summary?.training_time?.display_label || 'Not set'}
                  </Text>
                </View>
              </View>
              <View style={styles.heroMetaDivider} />
              <View style={styles.heroMeta}>
                <Ionicons name="pulse-outline" size={16} color={scoreColor} />
                <View style={styles.heroMetaCopy}>
                  <Text style={styles.heroMetaLabel}>READINESS</Text>
                  <Text style={styles.heroMetaValue}>{score === null ? '—' : `${Math.round(score)} / 100`}</Text>
                </View>
              </View>
            </View>
            <Text style={styles.heroFootnote}>
              {summary?.training_time?.display_label
                ? 'Suggested from your profile preference · not a booked appointment'
                : 'Set your preferred training time in Profile'}
            </Text>
            {!summary?.training_time?.display_label ? (
              <PressableScale
                style={styles.heroSetTime}
                onPress={() => router.push('/(tabs)/profile')}
                accessibilityRole="button"
                accessibilityLabel="Set preferred training time in Profile"
              >
                <Text style={styles.heroSetTimeText}>Set training window</Text>
                <Ionicons name="arrow-forward" size={13} color={COLORS.primaryGreen} />
              </PressableScale>
            ) : null}

            <PressableScale
              style={styles.heroButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
                router.push(summary?.recovery?.action === 'rest' ? '/(tabs)/coach' : '/(tabs)/workout');
              }}
            >
              <Text style={styles.heroButtonText}>
                {summary?.recovery?.action === 'rest' ? 'Open Coach guidance' : workoutType ? 'Review today’s session' : 'Open training'}
              </Text>
              <Ionicons name="arrow-forward" size={18} color={COLORS.background} />
            </PressableScale>
          </View>
        </ImageBackground>

        {summary?.recovery?.action === 'check_in' ? (
          <PressableScale
            style={styles.recoveryCheckInButton}
            onPress={() => setRecoveryCheckInVisible(true)}
          >
            <Ionicons name="clipboard-outline" size={16} color={COLORS.primaryGreen} />
            <Text style={styles.recoveryCheckInText}>Complete today's recovery check-in</Text>
            <Ionicons name="arrow-forward" size={15} color={COLORS.primaryGreen} />
          </PressableScale>
        ) : null}

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionEyebrow}>LIVE SNAPSHOT</Text>
            <Text style={styles.sectionTitle}>Your day at a glance</Text>
          </View>
          <View style={styles.snapshotCaption}>
            <View style={styles.snapshotLiveDot} />
            <Text style={styles.snapshotCaptionText}>TODAY</Text>
          </View>
        </View>

        <View style={styles.snapshotPanel}>
          <View style={styles.snapshotCell}>
            <View style={[styles.snapshotIcon, { backgroundColor: alpha(scoreColor, 0.12) }]}>
              <Ionicons name="pulse-outline" size={16} color={scoreColor} />
            </View>
            <Text style={styles.snapshotValue}>{score === null ? '—' : Math.round(score)}</Text>
            <Text style={styles.snapshotLabel}>READINESS</Text>
          </View>
          <View style={styles.snapshotDivider} />
          <View style={styles.snapshotCell}>
            <View style={[styles.snapshotIcon, { backgroundColor: alpha(COLORS.calories, 0.12) }]}>
              <Ionicons name="flame-outline" size={16} color={COLORS.calories} />
            </View>
            <Text style={styles.snapshotValue}>
              {summary?.nutrition_status?.calories_remaining == null
                ? '—'
                : Math.round(summary.nutrition_status.calories_remaining).toLocaleString('en-IN')}
            </Text>
            <Text style={styles.snapshotLabel}>KCAL LEFT</Text>
          </View>
          <View style={styles.snapshotDivider} />
          <View style={styles.snapshotCell}>
            <View style={[styles.snapshotIcon, { backgroundColor: alpha(COLORS.protein, 0.12) }]}>
              <Ionicons name="nutrition-outline" size={16} color={COLORS.protein} />
            </View>
            <Text style={styles.snapshotValue}>
              {summary?.nutrition_status?.protein_remaining_g == null
                ? '—'
                : `${Math.round(summary.nutrition_status.protein_remaining_g)}g`}
            </Text>
            <Text style={styles.snapshotLabel}>PROTEIN LEFT</Text>
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionEyebrow}>QUICK ACTIONS</Text>
            <Text style={styles.sectionTitle}>Keep your day moving</Text>
          </View>
        </View>
        <View style={styles.quickActions}>
          <QuickAction
            icon="nutrition-outline"
            title="Log food"
            subtitle="Update today's nutrition"
            accent={COLORS.carbs}
            onPress={() => router.push({ pathname: '/(tabs)/nutrition', params: { openLog: '1' } } as any)}
          />
          <QuickAction
            icon="stats-chart-outline"
            title="See progress"
            subtitle="Body, strength and trends"
            accent={COLORS.strain}
            onPress={() => router.push('/(tabs)/progress')}
          />
        </View>

        {coachMessage ? (
          <PressableScale
            style={styles.coachPanel}
            onPress={() => router.push('/(tabs)/coach')}
            accessibilityRole="button"
            accessibilityLabel="Open the personal coach"
          >
            <View style={styles.coachPanelTop}>
              <View style={styles.coachIcon}>
                <Ionicons name="sparkles" size={17} color={COLORS.coachPurple} />
              </View>
              <Text style={styles.coachLabel}>COACH'S READ ON TODAY</Text>
              <Ionicons name="arrow-up-right-box" size={16} color={COLORS.coachPurple} />
            </View>
            <Text style={styles.coachMessage} numberOfLines={3}>{coachMessage}</Text>
            {summary?.proactive_brief?.why_summary ? (
              <Text style={styles.coachReason} numberOfLines={2}>{summary.proactive_brief.why_summary}</Text>
            ) : null}
          </PressableScale>
        ) : null}

        <ProgramEvolutionCard />
      </ScrollView>
      <RecoveryCheckInModal
        visible={recoveryCheckInVisible}
        existing={existingRecoveryCheckIn}
        saving={savingRecoveryCheckIn}
        onSave={saveRecoveryCheckIn}
        onClose={() => setRecoveryCheckInVisible(false)}
      />
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
  homeHeading: { gap: 3 },
  brandName: {
    color: COLORS.text,
    fontFamily: FONTS.numericSemibold,
    fontSize: 27,
    lineHeight: 32,
    letterSpacing: -0.8,
  },
  brandSub: {
    color: COLORS.primaryGreen,
    fontFamily: FONTS.bold,
    fontSize: 9,
    letterSpacing: 1.5,
  },
  pageHeading: { marginBottom: 23, gap: 6 },
  dateLabel: {
    color: COLORS.textMuted,
    fontFamily: FONTS.semibold,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  greeting: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 19, lineHeight: 25, letterSpacing: -0.2 },
  greetingSub: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 18 },
  heroCard: {
    minHeight: 380,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: COLORS.card,
    marginBottom: 25,
    justifyContent: 'flex-end',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  heroImage: { borderRadius: 28 },
  heroContent: { flex: 1, justifyContent: 'space-between', padding: 19, minHeight: 380 },
  heroTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(4,8,12,0.56)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  heroLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primaryGreen },
  heroEyebrowText: { fontFamily: FONTS.bold, color: '#F6F7F1', fontSize: 9, letterSpacing: 1.2 },
  heroStatus: { backgroundColor: 'rgba(5,9,13,0.58)', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 9, paddingVertical: 6 },
  heroStatusText: { fontFamily: FONTS.bold, color: '#F6F7F1', fontSize: 9, letterSpacing: 0.8 },
  heroCopy: { marginTop: 110 },
  heroKicker: { fontFamily: FONTS.bold, color: COLORS.primaryGreen, fontSize: 10, letterSpacing: 1.7, marginBottom: 8 },
  heroTitle: { fontFamily: FONTS.numericBold, color: '#FFFFFF', fontSize: 35, lineHeight: 39, letterSpacing: -1.1, marginBottom: 9 },
  heroDescription: { fontFamily: FONTS.medium, color: 'rgba(255,255,255,0.86)', fontSize: 12, lineHeight: 19, maxWidth: 320 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 17 },
  heroMeta: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  heroMetaCopy: { flex: 1, minWidth: 0 },
  heroMetaLabel: { color: 'rgba(255,255,255,0.62)', fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 0.9, marginBottom: 3 },
  heroMetaValue: { color: '#FFFFFF', fontFamily: FONTS.numericSemibold, fontSize: 12 },
  heroMetaDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.24)' },
  heroFootnote: { color: 'rgba(255,255,255,0.62)', fontFamily: FONTS.regular, fontSize: 9, lineHeight: 13, marginTop: 8 },
  heroSetTime: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingTop: 6 },
  heroSetTimeText: { color: COLORS.primaryGreen, fontFamily: FONTS.semibold, fontSize: 10 },
  heroButton: { minHeight: 50, marginTop: 15, borderRadius: 16, paddingHorizontal: 16, backgroundColor: COLORS.primaryGreen, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroButtonText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 12, letterSpacing: 0.1 },
  snapshotCaption: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  snapshotLiveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.primaryGreen },
  snapshotCaptionText: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 0.8 },
  snapshotPanel: { flexDirection: 'row', alignItems: 'center', minHeight: 116, borderRadius: 22, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, paddingHorizontal: 7, paddingVertical: 13, marginBottom: 25 },
  snapshotCell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  snapshotIcon: { width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  snapshotValue: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 19, lineHeight: 22 },
  snapshotLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 0.75 },
  snapshotDivider: { width: 1, height: 48, backgroundColor: COLORS.border },
  coachReason: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15, marginTop: 9 },
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
  eyebrow: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.45 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.9 },
  readinessBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 19 },
  readinessCopy: { flex: 1, paddingRight: 2 },
  readinessHeadline: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 20, lineHeight: 25, letterSpacing: -0.35, marginBottom: 6 },
  readinessDescription: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 16 },
  readinessFootnote: { color: COLORS.textDim, fontFamily: FONTS.semibold, fontSize: 10, letterSpacing: 0.75, marginTop: 11 },
  recoveryCheckInButton: {
    minHeight: 44,
    marginTop: -16,
    marginBottom: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: alpha(COLORS.primaryGreen, 0.3),
    backgroundColor: alpha(COLORS.primaryGreen, 0.07),
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  recoveryCheckInText: {
    color: COLORS.primaryGreen,
    fontFamily: FONTS.semibold,
    fontSize: 11,
    flex: 1,
  },
  dial: { width: 98, height: 98, alignItems: 'center', justifyContent: 'center' },
  dialCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  dialScore: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 27, lineHeight: 31, letterSpacing: -0.8 },
  dialOutOf: { color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 10, letterSpacing: 0.5, marginTop: -1 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 },
  sectionEyebrow: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.35 },
  sectionTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 21, lineHeight: 27, letterSpacing: -0.4, marginTop: 3 },
  rescheduledLabel: { color: COLORS.warning, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.8, marginBottom: 5 },
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
  trainingLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.15, marginBottom: 4 },
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
  coachLabel: { color: COLORS.textSecondary, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.05, flex: 1 },
  coachAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  coachActionText: { color: COLORS.coachPurple, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.65 },
  coachMessage: { color: COLORS.text, fontFamily: FONTS.medium, fontSize: 13, lineHeight: 20 },
  quickActions: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  quickAction: { flex: 1, minHeight: 132, borderRadius: 22, borderWidth: 1, borderColor: COLORS.borderLight, backgroundColor: COLORS.cardElevated, padding: 15, justifyContent: 'space-between', overflow: 'hidden' },
  quickIcon: { width: 43, height: 43, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  quickCopy: { gap: 4, paddingTop: 14, paddingRight: 8 },
  quickTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 14 },
  quickSubtitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 },
  quickArrow: { position: 'absolute', right: 14, top: 14, width: 27, height: 27, borderRadius: 10, backgroundColor: alpha(COLORS.text, 0.05), alignItems: 'center', justifyContent: 'center' },
  errorScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, paddingHorizontal: 28 },
  errorIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  errorTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 22, textAlign: 'center', marginBottom: 8 },
  errorBody: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 19, textAlign: 'center', marginBottom: 22 },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 19, paddingVertical: 13, borderRadius: 15, backgroundColor: COLORS.primaryGreen },
  retryText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 12 },
});
