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
//   3. What does the coach say?   → CoachInsightCard
//   4. Am I improving?            → MomentumCard
//   5. The real numbers           → WeeklyPerformanceCard
//   6. What can I expect next?    → PredictionCard
//   7. What have I earned?        → AchievementCard
//   8. Is my program still right? → ProgramHealthCard
//   9. What happened today?       → TimelineCard
//  10. Anything the coach caught? → PatternInsightsCard
//  11. Where else can I go?       → QuickToolsCard

import React, { useCallback, useEffect, useState, useRef } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { dashboardApi, missionApi, analyticsApi, describeApiError } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS } from '../../theme/colors';
import { SPACING } from '../../theme/spacing';
import Text from '../ui/Text';
import DashboardSkeleton from './DashboardSkeleton';
import DashboardHeader from './DashboardHeader';
import AIReadinessHero from './AIReadinessHero';
import CoachInsightCard from './CoachInsightCard';
import MomentumCard from './MomentumCard';
import WeeklyPerformanceCard from './WeeklyPerformanceCard';
import PredictionCard from './PredictionCard';
import AchievementCard from './AchievementCard';
import ProgramHealthCard from './ProgramHealthCard';
import TimelineCard from './TimelineCard';
import PatternInsightsCard from './PatternInsightsCard';
import QuickToolsCard from './QuickToolsCard';

interface DashboardSummary {
  greeting: string;
  mission_text: string;
  next_task: string;
  workout_today: { type: string | null; rescheduled: boolean; message: string };
  recovery: { score: number; action: string; message: string };
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

export default function DashboardScreen() {
  const { user, profile, setCnsFatigue } = useStore();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Real "sessions completed this week" count from /progress/weekly-stats,
  // shared with MomentumCard's weekly-consistency bar. null while
  // unknown/unavailable so the UI quietly omits it instead of a fake number.
  const [weeklySessions, setWeeklySessions] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setErrorMsg(null);
    try {
      // Try mission endpoint first (has proactive_brief + pattern_insights)
      let res;
      try {
        res = await missionApi.getToday();
      } catch {
        res = await dashboardApi.getSummary();
      }
      setSummary(res.data);
      if (typeof res.data.cns_fatigue === 'number') {
        setCnsFatigue(res.data.cns_fatigue);
      }
    } catch (err: any) {
      const { message } = describeApiError(err);
      setErrorMsg(message);
    }
    try {
      const weekly = await analyticsApi.getWeeklyStats();
      if (typeof weekly.data?.sessions_completed === 'number') {
        setWeeklySessions(weekly.data.sessions_completed);
      }
    } catch {
      // Non-critical — stat is simply omitted if this fails.
    }
  }, [setCnsFatigue]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadData();
      setLoading(false);
    })();
  }, [loadData]);

  // Refetch whenever this tab regains focus (e.g. returning from a just-
  // completed workout) so the readiness ring, AI decision, and streaks
  // never show stale pre-session data. Skips the very first focus since
  // the mount effect above already covers it.
  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
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
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.recoveryHigh} />
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
        recoveryScore0to10={summary?.recovery?.score ?? 0}
        avatarUrl={profile?.avatar_url}
      />

      {/* 2. What should I do, why, and what result can I expect? */}
      <AIReadinessHero
        workoutType={summary?.workout_today?.type ?? null}
        workoutStreak={summary?.workout_streak ?? 0}
      />

      {/* 3. What does the coach say? */}
      {summary?.proactive_brief && (
        <CoachInsightCard brief={summary.proactive_brief} />
      )}

      {/* 4. Am I improving? */}
      <MomentumCard
        workoutStreak={summary?.workout_streak ?? 0}
        proteinStreak={summary?.protein_streak ?? 0}
        weeklySessions={weeklySessions}
      />

      {/* 5. The real numbers behind this week */}
      <WeeklyPerformanceCard />

      {/* 6. What can I expect next? */}
      <PredictionCard />

      {/* 7. What have I earned? */}
      <AchievementCard workoutStreak={summary?.workout_streak ?? 0} />

      {/* 8. Is my program still the right one? */}
      <ProgramHealthCard />

      {/* 9. What happened today? */}
      <TimelineCard />

      {/* 10. Anything the coach caught proactively? */}
      {summary?.pattern_insights && summary.pattern_insights.length > 0 && (
        <PatternInsightsCard insights={summary.pattern_insights} />
      )}

      {/* 11. Where else can I go? */}
      <QuickToolsCard />

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
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
});
