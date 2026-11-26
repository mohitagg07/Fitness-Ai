// VYRN — Mission Control Dashboard
//
// A slim orchestrator: fetches the real dashboard-summary payload once
// (falling back from /mission/today to /dashboard/summary, exactly as
// before) plus this week's real session count, then hands that data down
// to a fixed stack of single-purpose cards. Each card owns its own fetch
// for anything beyond the summary — this file does no chart math, no
// mock data, and no per-screen one-off styling; every visual primitive
// it touches (Text, Button, SectionLabel...) comes from the shared
// design system in components/ui.
//
// Section order mirrors the product brief, one question per section:
//   1. Am I ready today?          → DashboardHeader
//   2. What should I do & why?    → AIReadinessHero
//  2b. Have I been consistent?    → ConsistencyScoreCard
//   3. What does the coach say?   → CoachInsightCard
//   4. Am I improving?            → MomentumCard
//   5. The real numbers           → WeeklyPerformanceCard
//   6. What can I expect next?    → PredictionCard
//   7. What have I earned?        → AchievementCard
//   8. Is my program still right? → ProgramHealthCard
//   9. What happened today?       → TimelineCard
//  10. Anything the coach caught? → PatternInsightsCard
//  11. Where else can I go?       → QuickToolsCard

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { describeApiError } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS } from '../../theme/colors';
import { SPACING } from '../../theme/spacing';
import Text from '../ui/Text';
import AmbientGlow from '../shared/AmbientGlow';
import DashboardSkeleton from './DashboardSkeleton';
import DashboardHeader from './DashboardHeader';
import AIReadinessHero from './AIReadinessHero';
import CoachInsightCard from './CoachInsightCard';
import ConsistencyScoreCard from './ConsistencyScoreCard';
import MomentumCard from './MomentumCard';
import WeeklyPerformanceCard from './WeeklyPerformanceCard';
import PredictionCard from './PredictionCard';
import AchievementCard from './AchievementCard';
import ProgramHealthCard from './ProgramHealthCard';
import TimelineCard from './TimelineCard';
import PatternInsightsCard from './PatternInsightsCard';
import QuickToolsCard from './QuickToolsCard';
import { useMissionSummary, useWeeklyStats, useRefreshDashboard } from '../../hooks/useDashboardQueries';

interface DashboardSummary {
  greeting: string;
  mission_text: string;
  next_task: string;
  workout_today: { type: string | null; rescheduled: boolean; message: string };
  recovery: { score: number; score_pct?: number; action: string; message: string };
  cns_fatigue: number;
  workout_streak: number;
  protein_streak: number;
  motivation_message: string;
  pattern_insights?: Array<{
    category: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    detail: string;
    recommendation: string;
    confidence: string;
  }>;
  proactive_brief?: {
    coach_message: string;
    todays_focus: string;
    recommendation: string;
    suggested_top_set: string | null;
    confidence_pct: number;
    confidence: string;
    why_summary: string;
    proactive_notices: string[];
    reasoning_steps?: Array<{ label: string; finding: string; implication: string }>;
  };
}

// PERF: previously a hand-rolled useEffect+useFocusEffect fetch behind a
// single `loading` boolean — every focus re-fetched both endpoints from
// zero and the whole screen unmounted to a skeleton on any refresh.
// useMissionSummary/useWeeklyStats share the app-wide query cache
// (staleTime: short — see queryKeys.ts) with automatic refetch-on-focus
// wired once in lib/queryClient.ts, so a warm return to this tab renders
// instantly from cache while a background refetch quietly confirms it's
// current — no manual focus-tracking needed here anymore.
export default function DashboardScreen() {
  // Selector form: this screen only re-renders on a store update when
  // user/profile/setCnsFatigue actually change — not on every chat
  // message or workout set logged elsewhere in the app while this tab
  // stays mounted in the background. See src/store/index.ts.
  const { user, profile, setCnsFatigue } = useStore((s) => ({
    user: s.user, profile: s.profile, setCnsFatigue: s.setCnsFatigue,
  }));
  const [showFullReport, setShowFullReport] = useState(false);

  const { data: summary, isPending: loading, error, isRefetching } = useMissionSummary() as {
    data?: DashboardSummary; isPending: boolean; error: unknown; isRefetching: boolean;
  };
  // Real "sessions completed this week" count from /progress/weekly-stats,
  // shared with MomentumCard's weekly-consistency bar. null while
  // unknown/unavailable so the UI quietly omits it instead of a fake number.
  const { data: weeklyStats } = useWeeklyStats();
  const weeklySessions: number | null =
    typeof weeklyStats?.sessions_completed === 'number' ? weeklyStats.sessions_completed : null;

  const errorMsg = error ? describeApiError(error).message : null;

  const refreshDashboard = useRefreshDashboard();

  useEffect(() => {
    if (typeof summary?.cns_fatigue === 'number') {
      setCnsFatigue(summary.cns_fatigue);
    }
  }, [summary?.cns_fatigue, setCnsFatigue]);

  // Invalidates every card's query at once so pull-to-refresh updates the
  // whole page in parallel without unmounting any card back to a skeleton.
  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await refreshDashboard();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const firstName =
    user?.full_name?.split(' ')[0] || profile?.full_name?.split(' ')[0] || 'Athlete';

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (errorMsg && !summary) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textDim} />
        <Text variant="cardTitle" color={COLORS.text} align="center" style={{ marginTop: SPACING.lg }}>
          Couldn't load your dashboard
        </Text>
        <Text variant="body" color={COLORS.textSecondary} align="center" style={{ marginTop: SPACING.sm, lineHeight: 19 }}>
          {errorMsg}
        </Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRefresh}>
          <Ionicons name="refresh" size={16} color="#000" />
          <Text variant="body" weight="bold" color="#000" style={{ fontSize: 13 }}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const aiSentence =
    summary?.motivation_message || summary?.mission_text || summary?.recovery?.message ||
    "Recovery is looking good—today's a great day to train.";

  return (
    <View style={styles.root}>
      <AmbientGlow variant="recovery" recoveryScore0to100={(summary?.recovery?.score ?? 7) * 10} />
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={COLORS.recoveryHigh} />
        }
      >
      {errorMsg && summary && (
        <View style={styles.staleBanner}>
          <Ionicons name="warning-outline" size={14} color={COLORS.recoveryMed} />
          <Text variant="caption" color={COLORS.recoveryMed} style={{ flex: 1 }}>
            Showing last loaded data — {errorMsg}
          </Text>
        </View>
      )}

      {/* 1. Am I ready today? */}
      <DashboardHeader
        firstName={firstName}
        aiSentence={aiSentence}
        recoveryScore0to10={summary?.recovery?.score_pct != null ? summary.recovery.score_pct / 10 : (summary?.recovery?.score ?? 0)}
        avatarUrl={profile?.avatar_url}
      />

      {/* The first screen answers the three useful questions: am I ready,
          what should I do, and where can I go next. Deep analytics stay one
          deliberate tap away instead of competing with today's action. */}
      <AIReadinessHero
        workoutType={summary?.workout_today?.type ?? null}
        workoutStreak={summary?.workout_streak ?? 0}
      />

      {summary?.proactive_brief && (
        <CoachInsightCard brief={summary.proactive_brief} />
      )}

      <QuickToolsCard />

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: showFullReport }}
        onPress={() => setShowFullReport((value) => !value)}
        activeOpacity={0.78}
        style={styles.reportToggle}
      >
        <View style={styles.reportToggleCopy}>
          <Text variant="body" weight="semibold" color={COLORS.text}>
            {showFullReport ? 'Hide performance details' : 'Explore performance details'}
          </Text>
          <Text variant="caption" color={COLORS.textMuted}>
            Weekly trends, predictions, milestones and training history
          </Text>
        </View>
        <View style={styles.reportToggleIcon}>
          <Ionicons
            name={showFullReport ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={COLORS.primaryGreen}
          />
        </View>
      </TouchableOpacity>

      {showFullReport && (
        <View style={styles.fullReport}>
          <ConsistencyScoreCard />
          <MomentumCard
            workoutStreak={summary?.workout_streak ?? 0}
            proteinStreak={summary?.protein_streak ?? 0}
            weeklySessions={weeklySessions}
          />
          <WeeklyPerformanceCard />
          <PredictionCard />
          <AchievementCard workoutStreak={summary?.workout_streak ?? 0} />
          <ProgramHealthCard />
          <TimelineCard />
          {summary?.pattern_insights && summary.pattern_insights.length > 0 && (
            <PatternInsightsCard insights={summary.pattern_insights} />
          )}
        </View>
      )}

      <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: 'transparent' },
  centerContainer: {
    flex: 1, backgroundColor: COLORS.background,
    justifyContent: 'center', alignItems: 'center', padding: SPACING.xxl,
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: COLORS.strainGlow, borderRadius: 12,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl, marginTop: SPACING.lg,
  },
  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: 'rgba(255,222,0,0.08)', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
  },
  progressSection: { marginTop: SPACING.sm, marginBottom: SPACING.md },
  sectionDescription: { marginTop: 4, marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  reportToggle: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.cardElevated,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  reportToggleCopy: { flex: 1, gap: 4 },
  reportToggleIcon: {
    width: 34, height: 34, borderRadius: 12,
    backgroundColor: COLORS.backgroundTop,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  fullReport: { paddingTop: SPACING.sm },

});
