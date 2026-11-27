import React, { useEffect, useRef, useState } from 'react';
import {
  Text,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../../store';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import { useMissionSummary, useWeeklyStats, useRefreshDashboard } from '../../hooks/useDashboardQueries';
import { describeApiError } from '../../utils/api';
import { COLORS, alpha, recoveryColor } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import DashboardSkeleton from './DashboardSkeleton';
import ConsistencyScoreCard from './ConsistencyScoreCard';
import MomentumCard from './MomentumCard';
import WeeklyPerformanceCard from './WeeklyPerformanceCard';
import PredictionCard from './PredictionCard';
import AchievementCard from './AchievementCard';
import ProgramHealthCard from './ProgramHealthCard';
import TimelineCard from './TimelineCard';
import PatternInsightsCard from './PatternInsightsCard';
import Logo from '../shared/Logo';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface DashboardSummary {
  greeting?: string;
  mission_text?: string;
  next_task?: string;
  workout_today?: { type?: string | null; rescheduled?: boolean; message?: string };
  recovery?: { score?: number; score_pct?: number; action?: string; message?: string };
  cns_fatigue?: number;
  workout_streak?: number;
  protein_streak?: number;
  motivation_message?: string;
  pattern_insights?: Array<{
    category: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    detail: string;
    recommendation: string;
    confidence: string;
  }>;
  proactive_brief?: {
    coach_message?: string;
    todays_focus?: string;
    recommendation?: string;
    suggested_top_set?: string | null;
    confidence_pct?: number;
    confidence?: string;
    why_summary?: string;
    proactive_notices?: string[];
  };
}

function ReadinessDial({ score, color }: { score: number | null; color: string }) {
  const size = 112;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.stopAnimation();
    Animated.timing(progress, {
      toValue: score === null ? 0 : Math.max(0, Math.min(100, score)),
      duration: 760,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, score]);

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
        <View style={styles.dialScoreRow}>
          <Text style={styles.dialScore}>{score === null ? '—' : Math.round(score)}</Text>
        </View>
        <Text style={styles.dialOutOf}>OUT OF 100</Text>
      </View>
    </View>
  );
}

function TextLike({ children, style }: { children: React.ReactNode; style?: any }) {
  return <Text style={style}>{children}</Text>;
}

function SectionHeading({ eyebrow, title, right }: { eyebrow: string; title: string; right?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <View>
        <TextLike style={styles.eyebrow}>{eyebrow}</TextLike>
        <TextLike style={styles.sectionTitle}>{title}</TextLike>
      </View>
      {!!right && <TextLike style={styles.sectionRight}>{right}</TextLike>}
    </View>
  );
}

function Metric({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: string }) {
  return (
    <View style={styles.metric}>
      <View style={[styles.metricMarker, { backgroundColor: accent }]} />
      <TextLike style={styles.metricLabel}>{label}</TextLike>
      <TextLike style={styles.metricValue}>{value}</TextLike>
      <TextLike style={styles.metricDetail}>{detail}</TextLike>
    </View>
  );
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const responsive = useResponsiveLayout();
  const { user, profile } = useStore((state) => ({ user: state.user, profile: state.profile }));
  const [showFullReport, setShowFullReport] = useState(false);

  const { data: summary, isPending, error, isRefetching } = useMissionSummary() as {
    data?: DashboardSummary;
    isPending: boolean;
    error: unknown;
    isRefetching: boolean;
  };
  const { data: weeklyStats } = useWeeklyStats();
  const refreshDashboard = useRefreshDashboard();

  const firstName = user?.full_name?.split(' ')[0] || profile?.full_name?.split(' ')[0] || 'Athlete';
  const rawScore = typeof summary?.recovery?.score_pct === 'number'
    ? summary.recovery.score_pct
    : typeof summary?.recovery?.score === 'number'
      ? summary.recovery.score * 10
      : null;
  const score = rawScore === null ? null : Math.max(0, Math.min(100, rawScore));
  const scoreColor = score === null ? COLORS.textMuted : recoveryColor(score);
  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'GOOD MORNING' : greetingHour < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  const todayLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date()).toUpperCase();
  const weeklySessions = typeof weeklyStats?.sessions_completed === 'number'
    ? weeklyStats.sessions_completed
    : null;
  const workoutStreak = summary?.workout_streak ?? 0;
  const cnsFatigue = typeof summary?.cns_fatigue === 'number' ? summary.cns_fatigue : null;
  const workoutType = summary?.workout_today?.type?.trim();
  const coachMessage = summary?.proactive_brief?.coach_message
    || summary?.motivation_message
    || summary?.mission_text
    || null;
  const errorMessage = error ? describeApiError(error).message : null;

  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    await refreshDashboard();
  };

  if (isPending && !summary) return <DashboardSkeleton />;

  if (errorMessage && !summary) {
    return (
      <View style={[styles.errorScreen, { paddingTop: insets.top + 24 }]}>
        <View style={styles.errorIcon}><Ionicons name="cloud-offline-outline" size={24} color={COLORS.textSecondary} /></View>
        <TextLike style={styles.errorTitle}>Your training data is taking a break.</TextLike>
        <TextLike style={styles.errorBody}>{errorMessage}</TextLike>
        <TouchableOpacity style={styles.retryButton} onPress={() => void refreshDashboard()}>
          <Ionicons name="refresh" size={16} color={COLORS.background} />
          <TextLike style={styles.retryText}>Try again</TextLike>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 12,
            paddingBottom: Math.max(insets.bottom, 12) + 28,
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
          <View style={styles.brandLockup}>
            <Logo size="sm" />
            <View>
              <TextLike style={styles.brandName}>VYRN</TextLike>
              <TextLike style={styles.brandSub}>PERFORMANCE SYSTEM</TextLike>
            </View>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            onPress={() => router.push('/(tabs)/profile')}
            style={styles.profileButton}
          >
            <Ionicons name="person-outline" size={19} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.greetingBlock}>
          <TextLike style={styles.dateLabel}>{todayLabel}</TextLike>
          <TextLike style={styles.greeting}>{greeting},</TextLike>
          <TextLike style={styles.name}>{firstName}.</TextLike>
          <TextLike style={styles.greetingSub}>Your training, recovery and progress. In one place.</TextLike>
        </View>

        <View style={styles.readinessPanel}>
          <View style={styles.readinessTopline}>
            <TextLike style={styles.eyebrow}>RECOVERY / READINESS</TextLike>
            <View style={[styles.livePill, { borderColor: alpha(scoreColor, 0.45) }]}>
              <View style={[styles.liveDot, { backgroundColor: scoreColor }]} />
              <TextLike style={[styles.liveText, { color: scoreColor }]}>
                {score === null ? 'WAITING' : score >= 67 ? 'READY' : score >= 34 ? 'MODERATE' : 'RECOVER'}
              </TextLike>
            </View>
          </View>
          <View style={styles.readinessBody}>
            <View style={styles.readinessCopy}>
              <TextLike style={styles.readinessHeadline}>
                {score === null ? 'Data gathering.' : score >= 67 ? 'Built for today.' : score >= 34 ? 'Find your pace.' : 'Recovery first.'}
              </TextLike>
              <TextLike style={styles.readinessDescription}>
                {summary?.recovery?.action || summary?.recovery?.message || 'Your readiness score will appear here when enough data is available.'}
              </TextLike>
              <TextLike style={styles.readinessFootnote}>BASED ON YOUR TRACKED RECOVERY DATA</TextLike>
            </View>
            <ReadinessDial score={score} color={scoreColor} />
          </View>
          <View style={styles.panelRule} />
          <View style={styles.panelFooter}>
            <View style={styles.panelFooterItem}>
              <Ionicons name="pulse-outline" size={14} color={COLORS.textMuted} />
              <TextLike style={styles.panelFooterText}>
                {cnsFatigue === null ? 'CNS data unavailable' : `CNS fatigue ${Math.round(cnsFatigue)}`}
              </TextLike>
            </View>
            <TextLike style={styles.panelFooterText}>PERSONAL BASELINE</TextLike>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading eyebrow="THE PLAN" title="Today's training" right={summary?.workout_today?.rescheduled ? 'RESCHEDULED' : undefined} />
          <View style={styles.trainingPanel}>
            <View style={styles.trainingIcon}>
              <Ionicons name="barbell-outline" size={23} color={COLORS.primaryGreen} />
            </View>
            <View style={styles.trainingCopy}>
              <TextLike style={styles.trainingLabel}>SCHEDULED SESSION</TextLike>
              <TextLike style={styles.trainingName}>{workoutType || 'No session scheduled'}</TextLike>
              <TextLike style={styles.trainingDetail}>
                {summary?.workout_today?.message || summary?.next_task || 'Your plan will update when your training schedule is available.'}
              </TextLike>
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.primaryButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
              router.push('/(tabs)/workout');
            }}
          >
            <TextLike style={styles.primaryButtonText}>Open training session</TextLike>
            <Ionicons name="arrow-forward" size={18} color={COLORS.background} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <SectionHeading eyebrow="CONSISTENCY" title="The work adds up" />
          <View style={styles.metricsPanel}>
            <Metric
              label="THIS WEEK"
              value={weeklySessions === null ? '—' : String(weeklySessions)}
              detail="sessions completed"
              accent={COLORS.primaryGreen}
            />
            <View style={styles.metricDivider} />
            <Metric
              label="WORKOUT STREAK"
              value={String(workoutStreak)}
              detail={workoutStreak === 1 ? 'day in a row' : 'days in a row'}
              accent={COLORS.gold}
            />
          </View>
          {weeklyStats?.has_data && (
            <View style={styles.weeklyPulse}>
              <View style={styles.weeklyPulseTop}>
                <TextLike style={styles.weeklyPulseEyebrow}>WEEKLY LOAD</TextLike>
                <TextLike style={styles.weeklyPulseMeta}>LOGGED SO FAR</TextLike>
              </View>
              <View style={styles.weeklyPulseMetrics}>
                <View style={styles.weeklyPulseMetric}>
                  <TextLike style={styles.weeklyPulseValue}>
                    {typeof weeklyStats.total_volume_kg === 'number'
                      ? weeklyStats.total_volume_kg >= 1000
                        ? (weeklyStats.total_volume_kg / 1000).toFixed(1) + ' t'
                        : Math.round(weeklyStats.total_volume_kg).toLocaleString() + ' kg'
                      : '—'}
                  </TextLike>
                  <TextLike style={styles.weeklyPulseLabel}>TOTAL VOLUME</TextLike>
                </View>
                <View style={styles.weeklyPulseDivider} />
                <View style={styles.weeklyPulseMetric}>
                  <TextLike style={styles.weeklyPulseValue}>
                    {typeof weeklyStats.total_minutes === 'number' ? weeklyStats.total_minutes + ' min' : '—'}
                  </TextLike>
                  <TextLike style={styles.weeklyPulseLabel}>TIME TRAINING</TextLike>
                </View>
                <View style={styles.weeklyPulseDivider} />
                <View style={styles.weeklyPulseMetric}>
                  <TextLike style={styles.weeklyPulseValue}>
                    {weeklyStats.avg_rpe == null ? '—' : weeklyStats.avg_rpe}
                  </TextLike>
                  <TextLike style={styles.weeklyPulseLabel}>AVG RPE</TextLike>
                </View>
              </View>
            </View>
          )}
        </View>

        {coachMessage && (
          <View style={styles.section}>
            <SectionHeading eyebrow="FROM YOUR COACH" title="A note for today" />
            <View style={styles.coachPanel}>
              <View style={styles.coachPanelTop}>
                <View style={styles.coachIcon}><Ionicons name="sparkles" size={17} color={COLORS.primaryGreen} /></View>
                <TextLike style={styles.coachLabel}>VYRN INTELLIGENCE</TextLike>
                {!!summary?.proactive_brief?.confidence && (
                  <TextLike style={styles.coachConfidence}>{summary.proactive_brief.confidence.toUpperCase()} CONFIDENCE</TextLike>
                )}
              </View>
              <TextLike style={styles.coachMessage}>{coachMessage}</TextLike>
              {!!summary?.proactive_brief?.todays_focus && (
                <View style={styles.focusRow}>
                  <TextLike style={styles.focusLabel}>TODAY'S FOCUS</TextLike>
                  <TextLike style={styles.focusText}>{summary.proactive_brief.todays_focus}</TextLike>
                </View>
              )}
              {!!summary?.proactive_brief?.suggested_top_set && (
                <View style={styles.topSetRow}>
                  <TextLike style={styles.focusLabel}>SUGGESTED TOP SET</TextLike>
                  <TextLike style={styles.topSet}>{summary.proactive_brief.suggested_top_set}</TextLike>
                </View>
              )}
              <TouchableOpacity style={styles.textLink} onPress={() => router.push('/(tabs)/coach')}>
                <TextLike style={styles.textLinkLabel}>Continue with Coach</TextLike>
                <Ionicons name="arrow-forward" size={15} color={COLORS.primaryGreen} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/(tabs)/coach')}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.text} />
            <TextLike style={styles.quickActionLabel}>Coach</TextLike>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/(tabs)/workout')}>
            <Ionicons name="barbell-outline" size={18} color={COLORS.text} />
            <TextLike style={styles.quickActionLabel}>Train</TextLike>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push({ pathname: '/(tabs)/progress', params: { tab: 'nutrition' } } as any)}>
            <Ionicons name="nutrition-outline" size={18} color={COLORS.text} />
            <TextLike style={styles.quickActionLabel}>Nutrition</TextLike>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/(tabs)/progress')}>
            <Ionicons name="analytics-outline" size={18} color={COLORS.text} />
            <TextLike style={styles.quickActionLabel}>Progress</TextLike>
          </TouchableOpacity>
        </View>
        <View style={styles.moreTools}>
          <TouchableOpacity style={styles.moreTool} onPress={() => router.push('/(tabs)/decisions')}>
            <Ionicons name="git-branch-outline" size={14} color={COLORS.textMuted} />
            <TextLike style={styles.moreToolText}>Decisions</TextLike>
          </TouchableOpacity>
          <TouchableOpacity style={styles.moreTool} onPress={() => router.push('/(tabs)/simulate')}>
            <Ionicons name="flask-outline" size={14} color={COLORS.textMuted} />
            <TextLike style={styles.moreToolText}>What If?</TextLike>
          </TouchableOpacity>
          <TouchableOpacity style={styles.moreTool} onPress={() => router.push('/(tabs)/formanalysis')}>
            <Ionicons name="body-outline" size={14} color={COLORS.textMuted} />
            <TextLike style={styles.moreToolText}>Form Check</TextLike>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded: showFullReport }}
          style={styles.reportToggle}
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setShowFullReport((current) => !current);
          }}
        >
          <View style={{ flex: 1 }}>
            <TextLike style={styles.reportTitle}>{showFullReport ? 'Hide performance report' : 'Explore performance report'}</TextLike>
            <TextLike style={styles.reportHint}>Trends, achievements, predictions and training history</TextLike>
          </View>
          <Ionicons name={showFullReport ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.primaryGreen} />
        </TouchableOpacity>

        {showFullReport && (
          <View style={styles.fullReport}>
            <ConsistencyScoreCard />
            <MomentumCard
              workoutStreak={workoutStreak}
              proteinStreak={summary?.protein_streak ?? 0}
              weeklySessions={weeklySessions}
            />
            <WeeklyPerformanceCard />
            <PredictionCard />
            <AchievementCard workoutStreak={workoutStreak} />
            <ProgramHealthCard />
            <TimelineCard />
            {summary?.pattern_insights?.length ? <PatternInsightsCard insights={summary.pattern_insights} /> : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1 },
  content: { width: '100%', alignSelf: 'center', gap: 0 },
  topline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 34 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 15, letterSpacing: 3.4 },
  brandSub: { color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 8, letterSpacing: 1.35, marginTop: 2 },
  profileButton: {
    width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.card,
  },
  greetingBlock: { marginBottom: 25 },
  dateLabel: { color: COLORS.primaryGreen, fontFamily: FONTS.semibold, fontSize: 10, letterSpacing: 1.45, marginBottom: 12 },
  greeting: { color: COLORS.textSecondary, fontFamily: FONTS.medium, fontSize: 18, lineHeight: 23 },
  name: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 43, lineHeight: 48, letterSpacing: -1.8 },
  greetingSub: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 13, lineHeight: 19, marginTop: 7 },
  readinessPanel: {
    borderRadius: 25, backgroundColor: '#101C15', borderWidth: 1, borderColor: '#26372B',
    padding: 19, marginBottom: 31, overflow: 'hidden',
  },
  readinessTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 1.65 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 30,
    paddingHorizontal: 9, paddingVertical: 5,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.1 },
  readinessBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 22, paddingBottom: 19 },
  readinessCopy: { flex: 1, paddingRight: 4 },
  readinessHeadline: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 24, lineHeight: 29, letterSpacing: -0.7, marginBottom: 8 },
  readinessDescription: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 18 },
  readinessFootnote: { color: COLORS.textDim, fontFamily: FONTS.semibold, fontSize: 7, letterSpacing: 0.9, marginTop: 13 },
  dial: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  dialCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  dialScoreRow: { flexDirection: 'row', alignItems: 'baseline' },
  dialScore: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 32, lineHeight: 38, letterSpacing: -1 },
  dialOutOf: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 7, letterSpacing: 1.2, marginTop: 1 },
  panelRule: { height: 1, backgroundColor: COLORS.border, marginBottom: 12 },
  panelFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelFooterItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  panelFooterText: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 9, letterSpacing: 0.55 },
  section: { marginBottom: 29 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 13 },
  sectionTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 21, lineHeight: 26, letterSpacing: -0.45, marginTop: 4 },
  sectionRight: { color: COLORS.recoveryMed, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 0.8, marginBottom: 4 },
  trainingPanel: {
    flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, borderRadius: 19,
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10,
  },
  trainingIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: alpha(COLORS.primaryGreen, 0.1), alignItems: 'center', justifyContent: 'center' },
  trainingCopy: { flex: 1 },
  trainingLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.35, marginBottom: 4 },
  trainingName: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 18, lineHeight: 22 },
  trainingDetail: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 16, marginTop: 4 },
  primaryButton: {
    minHeight: 52, borderRadius: 16, backgroundColor: COLORS.primaryGreen,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18,
  },
  primaryButtonText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 13, letterSpacing: 0.1 },
  metricsPanel: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 19, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 17, paddingHorizontal: 16 },
  weeklyPulse: { marginTop: 9, padding: 15, borderRadius: 18, backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border },
  weeklyPulseTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  weeklyPulseEyebrow: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.3 },
  weeklyPulseMeta: { color: COLORS.textDim, fontFamily: FONTS.semibold, fontSize: 7, letterSpacing: 0.9 },
  weeklyPulseMetrics: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weeklyPulseMetric: { flex: 1, minWidth: 0, gap: 5 },
  weeklyPulseValue: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 16, lineHeight: 20 },
  weeklyPulseLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 7, letterSpacing: 0.5 },
  weeklyPulseDivider: { width: 1, height: 29, backgroundColor: COLORS.border },
  metric: { flex: 1, gap: 5 },
  metricMarker: { width: 18, height: 2, borderRadius: 2, marginBottom: 3 },
  metricLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.1 },
  metricValue: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 30, lineHeight: 34 },
  metricDetail: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 10 },
  metricDivider: { width: 1, height: 65, backgroundColor: COLORS.border, marginHorizontal: 18 },
  coachPanel: { borderRadius: 20, padding: 17, backgroundColor: '#101C15', borderWidth: 1, borderColor: COLORS.border },
  coachPanelTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 },
  coachIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: alpha(COLORS.primaryGreen, 0.12), alignItems: 'center', justifyContent: 'center' },
  coachLabel: { color: COLORS.textSecondary, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.1, flex: 1 },
  coachConfidence: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 7, letterSpacing: 0.65 },
  coachMessage: { color: COLORS.text, fontFamily: FONTS.medium, fontSize: 15, lineHeight: 23, letterSpacing: -0.1 },
  focusRow: { marginTop: 16, paddingTop: 13, borderTopWidth: 1, borderTopColor: COLORS.border },
  focusLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 8, letterSpacing: 1.15, marginBottom: 5 },
  focusText: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 18 },
  topSetRow: { marginTop: 13 },
  topSet: { color: COLORS.primaryGreen, fontFamily: FONTS.numericBold, fontSize: 17 },
  textLink: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', marginTop: 17 },
  textLinkLabel: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 11 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 13 },
  quickAction: { width: '48%', minHeight: 54, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  moreTools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingHorizontal: 2 },
  moreTool: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 3 },
  moreToolText: { color: COLORS.textMuted, fontFamily: FONTS.medium, fontSize: 10 },
  quickActionLabel: { color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 10 },
  reportToggle: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.border, paddingVertical: 17, marginBottom: 10 },
  reportTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13 },
  reportHint: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, marginTop: 4 },
  fullReport: { paddingTop: 13 },
  errorScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, paddingHorizontal: 28 },
  errorIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center', marginBottom: 19 },
  errorTitle: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 22, textAlign: 'center', marginBottom: 9 },
  errorBody: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 19, textAlign: 'center', marginBottom: 22 },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 19, paddingVertical: 13, borderRadius: 14, backgroundColor: COLORS.primaryGreen },
  retryText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 12 },
});
