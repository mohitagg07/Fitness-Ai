// VYRN — Mission Control Dashboard
//
// Visual language rebuilt to match Whoop's actual UI grammar (verified
// against real product screenshots, not a generic dark-fitness-app guess):
// large circular score rings as the primary metric unit, color-coded by
// zone (green = good, yellow = moderate, red = needs attention), stacked
// as scrollable cards on a true-black background with minimal chrome.
// Data wiring is unchanged from the previous version — still calls the
// real GET /api/dashboard/summary endpoint with proper loading/error states.

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Image, Animated, Easing,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop, Text as SvgText } from 'react-native-svg';
import Logo from '../shared/Logo';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { dashboardApi, missionApi, progressApi, describeApiError } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS, alpha, recoveryColor as whoopRecoveryColor } from '../../theme/colors';
import { FONTS, EYEBROW, BODY } from '../../theme/typography';
import { SPACING, RADIUS } from '../../theme/spacing';
import ProactiveBriefCard from './ProactiveBriefCard';
import TodaysDecisionCard from './TodaysDecisionCard';
import SinceYesterdayCard from './SinceYesterdayCard';
import DashboardSkeleton from './DashboardSkeleton';
import PatternInsightsCard from './PatternInsightsCard';
import CoachTimelineCard from './CoachTimelineCard';
import ProgramEvolutionCard from './ProgramEvolutionCard';

const LOGO_MARK = require('../../../assets/branding/logo-mark.png');

// Animated logo intro — replaces the old static hero photo. Plays once on
// mount (fade + scale up), then settles into a slow breathing glow loop.
// A large, mostly-transparent watermark of the brand mark, not a loud
// centerpiece — it's there to make the header feel alive, not busy.
function AnimatedLogoIntro() {
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.spring(scale, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.logoIntroWrap,
        { opacity, transform: [{ scale: Animated.multiply(scale, pulseScale) }] },
      ]}
    >
      <Image source={LOGO_MARK} style={styles.logoIntroImg} resizeMode="contain" />
    </Animated.View>
  );
}

// Greeting name rendered as a gradient (lime → cyan) using SVG text, since
// RN has no native gradient-text support — mirrors the two-tone brand mark.
function GradientName({ text, fontSize }: { text: string; fontSize: number }) {
  const w = Math.max(40, text.length * fontSize * 0.62);
  return (
    <Svg width={w} height={fontSize * 1.3}>
      <Defs>
        <SvgGradient id="nameGrad" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={COLORS.primaryGreen} />
          <Stop offset="1" stopColor={COLORS.recoveryBlue} />
        </SvgGradient>
      </Defs>
      <SvgText
        x="0" y={fontSize * 0.95}
        fontSize={fontSize}
        fontWeight="800"
        fill="url(#nameGrad)"
      >
        {text}
      </SvgText>
    </Svg>
  );
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface DashboardSummary {
  greeting: string;
  mission_text: string;
  calories_remaining: number;
  protein_remaining_g: number;
  water_remaining_ml: number;
  calories_target: number;
  protein_target_g: number;
  water_target_ml: number;
  calories_pct: number;
  protein_pct: number;
  water_pct: number;
  next_task: string;
  workout_today: { type: string | null; rescheduled: boolean; message: string };
  recovery: { score: number; action: string; message: string };
  progress: { stalled: boolean; calorie_adjustment: number; message: string };
  cns_fatigue: number;
  workout_streak: number;
  protein_streak: number;
  motivation_message: string;
  sleep_goal: string | null;
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

// ── Whoop-style zone coloring: green / yellow / red bands ────────────────
// Whoop uses this exact three-zone language across Recovery, Strain, and
// Sleep Performance — a 0-10 (or 0-100) score always maps to one of three
// colors, never a continuous gradient. Replicated here for Recovery and
// the CNS Fatigue ring (inverted, since high fatigue = bad, mirroring how
// Whoop's Strain ring works in reverse of Recovery).
// Official WHOOP Recovery vocabulary (see theme/colors.ts) — previously
// this file used close-but-not-exact approximations (#16EC8C/#FFC23C/
// #FF5C5C); now sourced from the single COLORS definition so every
// screen in the app agrees on the same three hex values.
const ZONE_GREEN = COLORS.recoveryHigh;   // #16EC06
const ZONE_YELLOW = COLORS.recoveryMed;   // #FFDE00
const ZONE_RED = COLORS.recoveryLow;      // #FF0026

function recoveryZoneColor(score0to10: number) {
  if (score0to10 >= 7) return ZONE_GREEN;
  if (score0to10 >= 4) return ZONE_YELLOW;
  return ZONE_RED;
}
function fatigueZoneColor(score0to10: number) {
  // Inverted: low fatigue is good (green), high fatigue is bad (red)
  if (score0to10 <= 3) return ZONE_GREEN;
  if (score0to10 <= 6) return ZONE_YELLOW;
  return ZONE_RED;
}

// Friendlier display copy for the backend's snake_case recovery actions —
// "replace_with_light" read like a config key, not something a coach
// would actually say. Same information, more natural phrasing.
const ACTION_LABELS: Record<string, string> = {
  proceed: 'GO AS PLANNED',
  replace_with_light: 'TAKE IT EASY',
  rest: 'REST DAY',
  deload: 'DELOAD',
};
function actionLabel(action?: string) {
  if (!action) return '—';
  return ACTION_LABELS[action] || action.replace(/_/g, ' ').toUpperCase();
}

// "265" minutes -> "4h 25m" (falls back to "Xm" under an hour)
function formatTrainingTime(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default function DashboardScreen() {
  const { user, profile, setCnsFatigue } = useStore();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Real "sessions completed this week" count from /progress/weekly-stats —
  // used for the Workouts This Week stat. null while unknown/unavailable
  // so the UI can quietly omit the stat instead of showing a fake number.
  const [weeklySessions, setWeeklySessions] = useState<number | null>(null);
  // Real total training minutes logged this week from /progress/weekly-stats
  // (sum of completed sessions' duration_minutes) — used for the Training
  // Time stat. null while unknown/unavailable so the UI quietly omits it
  // instead of showing a fake duration.
  const [weeklyMinutes, setWeeklyMinutes] = useState<number | null>(null);

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
      const weekly = await progressApi.getWeeklyStats();
      if (typeof weekly.data?.sessions_completed === 'number') {
        setWeeklySessions(weekly.data.sessions_completed);
      }
      if (typeof weekly.data?.total_minutes === 'number') {
        setWeeklyMinutes(weekly.data.total_minutes);
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
  // completed workout) so the recovery score, decision card, and "Since
  // Yesterday" summary never show stale pre-session data. Skips the very
  // first focus since the mount effect above already covers it, and
  // deliberately doesn't toggle `loading` — a background refresh shouldn't
  // flash the skeleton every time the user switches tabs.
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

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName =
    user?.full_name?.split(' ')[0] || profile?.full_name?.split(' ')[0] || 'Athlete';

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (errorMsg && !summary) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textDim} />
        <Text style={styles.errorTitle}>Couldn't load your dashboard</Text>
        <Text style={styles.errorBody}>{errorMsg}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRefresh}>
          <Ionicons name="refresh" size={16} color="#000" />
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const cnsFatigue = summary?.cns_fatigue ?? 0;
  const recoveryScore = summary?.recovery.score ?? 0;

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
          <Text style={styles.staleBannerText}>Showing last loaded data — {errorMsg}</Text>
        </View>
      )}

      {/* Header — the old runner-photo banner is gone; a large, mostly-
          transparent animated logo mark now lives behind the greeting
          instead (fades/scales in on open, then breathes gently). Keeps
          the header feeling alive without fighting the text for
          contrast the way a busy photo did. */}
      <View style={styles.heroBanner}>
        <AnimatedLogoIntro />
        <View style={styles.headerTop}>
          <Logo size="sm" />
          <View style={styles.headerTopRight}>
            {profile?.goal && (
              <View style={styles.phaseBadge}>
                <View style={styles.phaseDot} />
                <Text style={styles.phaseText}>{profile.goal.toUpperCase()}</Text>
              </View>
            )}
            <TouchableOpacity hitSlop={10} onPress={() => router.push('/(tabs)/coach')}>
              <View>
                <Ionicons name="notifications-outline" size={22} color={COLORS.text} />
                <View style={styles.notifDot} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={10} onPress={() => router.push('/(tabs)/profile')}>
              <Ionicons name="menu-outline" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.headerGreeting}>
          <View style={styles.greetingLine}>
            <Text style={styles.greetingAccent}>{greeting}, </Text>
            <GradientName text={firstName} fontSize={26} />
            <Text style={styles.greetingWave}> 👋</Text>
          </View>
          <Text style={styles.greetingStatus} numberOfLines={3}>
            {summary?.recovery?.message || "Recovery is looking good—today's a great day to train."}
          </Text>
        </View>
      </View>

      {/* ── Morning-briefing story arc ────────────────────────────────────
          1. How am I today?      → score rings (this section)
          2. Start workout        → CTA button, immediately actionable
          3. What should I do?    → Workout Today card
          4. Why?                 → Today's Decision card (confidence,
                                     evidence, expandable reasoning)
          5. What's changed?      → Since Yesterday card
          6. What's my mission?   → Today's Mission card
          Everything below that is supporting detail the user can scroll
          into, not part of the briefing itself. ─────────────────────── */}

      {/* ── 1. How am I today? Primary score rings: Recovery + CNS Load,
          grouped inside one "Today's Readiness" shell so the two rings
          and the caption beneath them read as a single section instead
          of three elements floating separately on the black canvas. ── */}
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionLabelFirst, { marginHorizontal: 0, marginBottom: 0 }]}>TODAY'S READINESS</Text>
        <TouchableOpacity
          style={styles.viewInsightsBtn}
          onPress={() => router.push('/(tabs)/progress')}
          hitSlop={8}
        >
          <Text style={styles.viewInsightsText}>View Insights</Text>
          <Ionicons name="chevron-forward" size={13} color={COLORS.primaryGreen} />
        </TouchableOpacity>
      </View>
      <View style={styles.readinessGrid}>
        <ReadinessTile
          accent={recoveryZoneColor(recoveryScore)}
          icon="pulse"
          pillIcon="checkmark-circle"
          label="RECOVERY"
          pct={recoveryScore * 10}
          caption={actionLabel(summary?.recovery?.action)}
        />
        <ReadinessTile
          accent={fatigueZoneColor(cnsFatigue)}
          icon="flash"
          pillIcon="ellipse"
          label="CNS LOAD"
          pct={cnsFatigue * 10}
          caption={cnsFatigue >= 7 ? 'High Impact' : cnsFatigue >= 4 ? 'Moderate Impact' : 'Low Impact'}
        />
        <ReadinessTile
          accent={ZONE_YELLOW}
          icon="locate"
          pillIcon="time-outline"
          label="MISSION FOCUS"
          caption={summary?.next_task || summary?.mission_text || 'Open Coach'}
        />
        <ReadinessTile
          accent={COLORS.coachPurple}
          icon="star"
          pillIcon="star"
          label="COACH INSIGHT"
          pct={summary?.proactive_brief?.confidence_pct}
          caption={summary?.proactive_brief?.confidence ? `${summary.proactive_brief.confidence} Confidence` : 'Open Coach'}
        />
      </View>

      {/* ── Start workout — placed right under the readiness rings so the
          single primary action is immediately visible above the fold,
          instead of buried after several supporting cards. ────────────── */}
      {summary?.workout_today?.type && (
        <TouchableOpacity
          style={styles.startWorkoutWrap}
          activeOpacity={0.9}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            router.push('/(tabs)/workout');
          }}
        >
          <View style={styles.startWorkoutBtn}>
            <View style={styles.startWorkoutPlay}>
              <Ionicons name="play" size={16} color="#000" style={{ marginLeft: 2 }} />
            </View>
            <Text style={styles.startWorkoutText}>Start Today's Workout</Text>
            <Ionicons name="chevron-forward" size={20} color="rgba(0,0,0,0.5)" />
          </View>
        </TouchableOpacity>
      )}

      {/* Streak / weekly stats — sits directly under the Start Workout CTA. */}
      {summary && (summary.workout_streak > 0 || weeklySessions !== null || weeklyMinutes !== null) && (
        <View style={styles.statsBar}>
          <View style={styles.statItem}>
            <View style={styles.statTopRow}>
              <Ionicons name="flame" size={18} color={ZONE_YELLOW} />
              <Text style={styles.statValue}>{summary.workout_streak}</Text>
            </View>
            <Text style={styles.statLabel}>Day Streak</Text>
          </View>
          {weeklySessions !== null && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <View style={styles.statTopRow}>
                  <Ionicons name="barbell" size={16} color={ZONE_GREEN} />
                  <Text style={styles.statValue}>
                    {weeklySessions}{profile?.workout_days_per_week ? `/${profile.workout_days_per_week}` : ''}
                  </Text>
                </View>
                <Text style={styles.statLabel}>Workouts This Week</Text>
              </View>
            </>
          )}
          {weeklyMinutes !== null && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <View style={styles.statTopRow}>
                  <Ionicons name="time" size={16} color={COLORS.recoveryBlue} />
                  <Text style={styles.statValue}>{formatTrainingTime(weeklyMinutes)}</Text>
                </View>
                <Text style={styles.statLabel}>Training Time</Text>
              </View>
            </>
          )}
        </View>
      )}

      {/* ── 2. No plan yet? Show a fallback CTA to build one. Once a plan
          exists, Today's Decision card below already surfaces the workout
          type/focus/confidence — a separate "WORKOUT TODAY" card here was
          just repeating the same info a second time. ─────────────────── */}
      {summary && !summary.workout_today?.type && (
        <View style={styles.heroCard}>
          <View style={styles.workoutTodayHeader}>
            <View style={styles.workoutTodayLabelRow}>
              <Ionicons name="barbell-outline" size={13} color={COLORS.strain} />
              <Text style={[styles.eyebrow, { color: COLORS.strain }]}>WORKOUT TODAY</Text>
            </View>
          </View>
          <Text style={styles.workoutTodayType}>NO PLAN YET</Text>
          <Text style={styles.workoutTodayMsg}>No plan yet. Ask Coach to generate one based on your recovery.</Text>
          <TouchableOpacity
            style={styles.generatePlanBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              router.push('/(tabs)/coach');
            }}
          >
            <Ionicons name="flash" size={14} color="#000" />
            <Text style={styles.generatePlanBtnText}>Build Today's Workout</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 3. Why? Today's Decision card — confidence, evidence signals,
          and an expandable reasoning panel that justifies the workout
          card above. ───────────────────────────────────────────────── */}
      <TodaysDecisionCard />

      {/* ── 4. What's changed since yesterday? ─────────────────────────── */}
      <SinceYesterdayCard
        workoutStreak={summary?.workout_streak}
        proteinStreak={summary?.protein_streak}
      />

      {/* ── 5. What's my mission? Daily Mission ─────────────────────────── */}
      <View style={styles.heroCard}>
        <View style={styles.feedLabelRow}>
          <Ionicons name="flash" size={12} color={COLORS.recoveryBlue} />
          <Text style={[styles.eyebrow, { color: COLORS.recoveryBlue }]}>TODAY'S MISSION</Text>
        </View>
        <Text style={styles.feedText}>
          {summary?.mission_text || summary?.next_task || 'Open the Coach to get your first recommendation.'}
        </Text>
        <TouchableOpacity style={styles.feedBtn} onPress={() => router.push('/(tabs)/coach')}>
          <Text style={styles.feedBtnText}>Open Coach</Text>
          <Ionicons name="arrow-forward" size={14} color={COLORS.recoveryBlue} />
        </TouchableOpacity>
      </View>

      {/* ── Nutrition rings ──────────────────────────────────────────────── */}
      {summary && (
        <View style={styles.miniRingsRow}>
          <MiniRing
            pct={summary.calories_pct}
            color={COLORS.calories}
            label="CALORIES"
            value={`${summary.calories_remaining}`}
            sub={`of ${summary.calories_target}`}
          />
          <MiniRing
            pct={summary.protein_pct}
            color={COLORS.protein}
            label="PROTEIN"
            value={`${Math.round(summary.protein_remaining_g)}g`}
            sub={`of ${Math.round(summary.protein_target_g)}g`}
          />
          <MiniRing
            pct={summary.water_pct}
            color={COLORS.water}
            label="WATER"
            value={`${(Math.round(summary.water_remaining_ml / 100) / 10).toFixed(1)}L`}
            sub={`of ${(Math.round(summary.water_target_ml / 100) / 10).toFixed(1)}L`}
          />
        </View>
      )}




      {/* Proactive AI Coach Brief — coach thinks before user types */}
      {summary?.proactive_brief && (
        <ProactiveBriefCard
          brief={summary.proactive_brief}
          firstName={firstName}
        />
      )}

      {/* Pattern Detection Insights */}
      {summary?.pattern_insights && summary.pattern_insights.length > 0 && (
        <PatternInsightsCard insights={summary.pattern_insights} />
      )}

      {/* AI Insights card (motivation fallback) */}
      {summary?.motivation_message && !summary?.proactive_brief && (
        <View style={styles.heroCard}>
          <View style={styles.aiInsightsHeader}>
            <Ionicons name="sparkles" size={13} color={COLORS.strainGlow} />
            <Text style={[styles.eyebrow, { color: COLORS.strainGlow }]}>I NOTICED SOMETHING</Text>
          </View>
          <Text style={styles.aiInsightsText}>{summary.motivation_message}</Text>
          <TouchableOpacity style={styles.feedBtn} onPress={() => router.push('/(tabs)/coach')}>
            <Text style={styles.feedBtnText}>Ask Coach</Text>
            <Ionicons name="arrow-forward" size={14} color={COLORS.strainGlow} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Phase 2: Coach Timeline ─────────────────────────────────── */}
      <CoachTimelineCard />

      {/* ── Phase 2: Program Evolution ───────────────────────────────── */}
      <ProgramEvolutionCard />

      {/* Secondary feature cards — Decisions/Simulate/Form check moved off
          bottom nav. (The old "QUICK START" grid above this was removed:
          its three buttons — Ask Coach / Gym Mode / Analytics — routed to
          the exact same Coach/Workout/Progress tabs already in the bottom
          bar, so it was a second nav bar with nothing new to offer.) */}
      <Text style={[styles.sectionLabel, { marginTop: SPACING.lg }]}>MORE TOOLS</Text>
      <View style={styles.aiToolsGrid}>
        <TouchableOpacity style={[styles.aiToolBtn, { borderColor: alpha(COLORS.strainGlow, 0.25) }]} onPress={() => router.push('/(tabs)/decisions')}>
          <Ionicons name="analytics-outline" size={22} color={COLORS.strainGlow} />
          <Text style={styles.aiToolLabel}>Decisions</Text>
          <Text style={styles.aiToolSub}>Past calls & how they played out</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.aiToolBtn, { borderColor: alpha(COLORS.recoveryMed, 0.25) }]} onPress={() => router.push('/(tabs)/simulate')}>
          <Ionicons name="flask-outline" size={22} color={COLORS.recoveryMed} />
          <Text style={styles.aiToolLabel}>What If?</Text>
          <Text style={styles.aiToolSub}>See how changes play out</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.aiToolBtn, { borderColor: alpha(COLORS.recoveryLow, 0.25) }]} onPress={() => router.push('/(tabs)/formanalysis')}>
          <Ionicons name="body-outline" size={22} color={COLORS.recoveryLow} />
          <Text style={styles.aiToolLabel}>Form Check</Text>
          <Text style={styles.aiToolSub}>Camera form feedback</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

// ── Reusable ring primitives ─────────────────────────────────────────────

// Compact 2x2 readiness tile — used for Recovery / CNS Load / Mission
// Focus / Coach Insight. When `pct` is provided it draws a small ring
// (matching the Recovery/CNS/Coach cards); when omitted (Mission Focus
// has no single number) it shows a static target glyph instead, so the
// tile still has a strong focal shape rather than an empty icon.
function ReadinessTile({
  accent, icon, pillIcon, label, pct, caption,
}: {
  accent: string; icon: IoniconName; pillIcon: IoniconName; label: string; pct?: number; caption: string;
}) {
  const hasRing = typeof pct === 'number' && !Number.isNaN(pct);
  const size = 60;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, (pct ?? 0) / 100));
  const dashOffset = circumference * (1 - clamped);

  return (
    <View style={[styles.tile, { borderColor: alpha(accent, 0.22) }]}>
      <View style={styles.tileHeaderRow}>
        <Ionicons name={icon} size={12} color={accent} />
        <Text style={[styles.tileLabel, { color: accent }]}>{label}</Text>
      </View>
      <View style={styles.tileBody}>
        {hasRing ? (
          <View style={{ width: size, height: size }}>
            <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
              <Circle cx={size / 2} cy={size / 2} r={radius} stroke={COLORS.cardElevated} strokeWidth={stroke} fill="none" />
              <Circle
                cx={size / 2} cy={size / 2} r={radius}
                stroke={accent} strokeWidth={stroke} fill="none"
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                rotation={-90}
                origin={`${size / 2}, ${size / 2}`}
              />
            </Svg>
            <View style={styles.tileRingCenter}>
              <Text style={[styles.tileRingValue, { color: accent }]}>{Math.round(pct as number)}</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.tileTargetOuter, { borderColor: alpha(accent, 0.35) }]}>
            <View style={[styles.tileTargetMid, { borderColor: alpha(accent, 0.6) }]}>
              <View style={[styles.tileTargetDot, { backgroundColor: accent }]} />
            </View>
          </View>
        )}
      </View>
      <View style={[styles.tilePill, { backgroundColor: alpha(accent, 0.14) }]}>
        <Ionicons name={pillIcon} size={11} color={accent} />
        <Text style={[styles.tilePillText, { color: accent }]} numberOfLines={1}>{caption}</Text>
      </View>
    </View>
  );
}

function MiniRing({
  pct, color, label, value, sub,
}: {
  pct: number; color: string; label: string; value: string; sub: string;
}) {
  const size = 64;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, pct / 100));
  const dashOffset = circumference * (1 - clamped);

  return (
    <View style={styles.miniRingWrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={COLORS.cardElevated} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={color} strokeWidth={stroke} fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        </Svg>
      </View>
      <Text style={styles.miniRingValue}>{value}</Text>
      <Text style={styles.miniRingLabel}>{label}</Text>
      <Text style={styles.miniRingSub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centerContainer: {
    flex: 1, backgroundColor: COLORS.background,
    justifyContent: 'center', alignItems: 'center', padding: SPACING.xxl,
  },
  errorTitle: { ...BODY, color: COLORS.text, fontFamily: FONTS.bold, fontSize: 17, marginTop: SPACING.lg, textAlign: 'center' },
  errorBody: { ...BODY, color: COLORS.textSecondary, fontSize: 13, marginTop: SPACING.sm, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: COLORS.strainGlow, borderRadius: RADIUS.button,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl, marginTop: SPACING.lg,
  },
  retryText: { ...BODY, color: '#000', fontFamily: FONTS.bold, fontSize: 13 },
  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: alpha(COLORS.recoveryMed, 0.08), paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
  },
  staleBannerText: { ...BODY, color: COLORS.recoveryMed, fontSize: 11, flex: 1 },
  heroBanner: {
    width: '100%', paddingHorizontal: SPACING.xl, paddingTop: 56,
    paddingBottom: SPACING.xl, justifyContent: 'space-between', overflow: 'hidden',
    position: 'relative', backgroundColor: COLORS.background, minHeight: 190,
  },
  // Large, mostly-transparent watermark of the brand mark, pinned to the
  // right so it doesn't compete with the greeting text on the left.
  logoIntroWrap: { position: 'absolute', right: -20, top: 30, opacity: 0.16 },
  logoIntroImg: { width: 190, height: 190 },
  headerTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTopRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
  notifDot: {
    position: 'absolute', top: -1, right: -1, width: 7, height: 7, borderRadius: 4,
    backgroundColor: COLORS.primaryGreen, borderWidth: 1.5, borderColor: COLORS.background,
  },
  headerGreeting: {
    gap: SPACING.xs, maxWidth: '80%', marginTop: SPACING.lg,
  },
  // Name/status line — "Good Morning, {name} 👋" in sentence case, same
  // body scale as the rest of the app (fontSize 16) rather than a small
  // eyebrow, so it reads as a real greeting sentence, not a label. The
  // name itself renders via <GradientName> (SVG text), so this is now a
  // row container rather than nested <Text>.
  greetingLine: { flexDirection: 'row', alignItems: 'center' },
  greetingAccent: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 16 },
  greetingWave: { fontSize: 18 },
  greetingStatus: { ...BODY, color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  // Phase badge now carries a live dot so it reads as status ("Phase 1,
  // active") rather than a static label sitting for no reason.
  phaseBadge: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.badge,
    paddingVertical: 6, paddingHorizontal: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  phaseDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.primaryGreen },
  phaseText: { ...EYEBROW, color: COLORS.textSecondary, fontSize: 11, letterSpacing: 1 },

  // One shared eyebrow style for every small uppercase card/section label —
  // cards differentiate by icon + text color only, never by font treatment.
  // Fixed at 11px everywhere (the canonical EYEBROW size in theme/typography.ts)
  // — this used to drift to 9/10/12 in different spots on this screen alone.
  eyebrow: { ...EYEBROW, fontSize: 11 },

  // Today's Readiness — four independent tiles (Recovery / CNS Load /
  // Mission Focus / Coach Insight), each owning its own accent color,
  // laid out as a 2x2 grid so all four morning signals are visible at
  // once instead of two rings living inside one green-tinted card.
  sectionLabelFirst: {
    ...EYEBROW, color: COLORS.textSecondary, fontSize: 11,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: SPACING.lg, marginBottom: SPACING.sm,
  },
  viewInsightsBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewInsightsText: { ...BODY, color: COLORS.primaryGreen, fontFamily: FONTS.semibold, fontSize: 12 },
  readinessGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.sm,
  },
  tile: {
    width: '48.2%', backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    padding: SPACING.md, borderWidth: 1,
  },
  tileHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: SPACING.sm },
  // Was 9px — smallest label on the whole screen for no reason. Now the
  // same 11px eyebrow size as every other small uppercase label.
  tileLabel: { ...EYEBROW, fontSize: 11, letterSpacing: 0.6 },
  tileBody: { alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.xs },
  tileRingCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  tileRingValue: { fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 18 },
  tileTargetOuter: {
    width: 60, height: 60, borderRadius: 30, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  tileTargetMid: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  tileTargetDot: { width: 10, height: 10, borderRadius: 5 },
  // Caption pill — colored translucent badge (accent @ 14% opacity) with
  // a small matching icon, replacing the old plain gray caption text so
  // each tile's verdict ("GO AS PLANNED", "YOU'VE GOT THIS") reads as a
  // real status chip instead of a caption line.
  tilePill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    borderRadius: RADIUS.badge, paddingVertical: 6, paddingHorizontal: SPACING.sm,
    marginTop: SPACING.sm, alignSelf: 'stretch',
  },
  tilePillText: { fontFamily: FONTS.bold, fontSize: 11, letterSpacing: 0.2 },
  // ── Hero cards ──────────────────────────────────────────────────────
  // Workout Today / Today's Mission / I Noticed Something all share this
  // one card shell. They differentiate purely through icon + label color
  // (strain blue / recovery green / strain glow teal) — never through a
  // one-off tinted background, so the "what should I focus on" story
  // reads as one consistent system instead of three competing cards.
  heroCard: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  feedLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm, gap: SPACING.xs },
  // Tightened from lineHeight 20 / marginBottom lg — the same sentence
  // was taking noticeably more vertical space than its neighbors for no
  // reason; this brings it in line with the density of the rest of the
  // briefing without cutting any text.
  feedText: { ...BODY, color: COLORS.textSecondary, fontSize: 14, lineHeight: 19, marginBottom: SPACING.sm },
  workoutTodayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  workoutTodayLabelRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  workoutTodayType: {
    color: COLORS.text, fontFamily: FONTS.black, fontSize: 28, letterSpacing: 0.3,
    marginBottom: SPACING.xs,
  },
  workoutTodayMsg: {
    ...BODY, color: COLORS.textSecondary, fontSize: 13, lineHeight: 19,
  },
  feedBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, alignSelf: 'flex-start' },
  // Link text stays neutral white; color now lives only in the arrow
  // icon (and picks up each card's own accent) so green isn't the
  // default color for every tappable label on the screen.
  feedBtnText: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13 },

  // Mini rings (nutrition) — pushed further from the CTA above to read as
  // its own "supporting detail" zone, per the briefing/detail split.
  miniRingsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    marginHorizontal: SPACING.lg, marginBottom: SPACING.lg, marginTop: SPACING.xl,
  },
  miniRingWrap: { alignItems: 'center', width: 90 },
  miniRingValue: { color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 13, marginTop: SPACING.sm },
  miniRingLabel: { ...EYEBROW, color: COLORS.textSecondary, fontSize: 9, letterSpacing: 1, marginTop: 2 },
  miniRingSub: { ...BODY, color: COLORS.textMuted, fontSize: 9, marginTop: 1 },

  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.card, padding: SPACING.lg,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  cardLabel: { ...EYEBROW, color: COLORS.textSecondary, fontSize: 11, marginBottom: SPACING.md },
  cardMessage: { ...BODY, color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: SPACING.xs },
  workoutRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  workoutType: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 16, flex: 1 },
  rescheduledBadge: { backgroundColor: alpha(COLORS.recoveryMed, 0.08), borderRadius: RADIUS.badge, paddingVertical: 3, paddingHorizontal: SPACING.sm },
  rescheduledText: { ...EYEBROW, color: COLORS.recoveryMed, fontSize: 9, letterSpacing: 0.5 },
  generatePlanBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: COLORS.strainGlow, borderRadius: RADIUS.button,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    alignSelf: 'flex-start', marginTop: SPACING.sm,
  },
  generatePlanBtnText: { color: '#000', fontFamily: FONTS.bold, fontSize: 13 },

  // Single primary CTA that closes the briefing — the brightest, largest
  // surface on the screen on purpose, so it reads as the one clear next
  // action (principle: strongest visual element, elegant not flashy).
  // Solid brand green (not a gradient) with centered text — matches the
  // reference layout's single-line "Start Today's Workout" button.
  startWorkoutWrap: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xxl, // extra breathing room — this closes the briefing story
    borderRadius: RADIUS.card,
    shadowColor: COLORS.primaryGreen,
    shadowOpacity: 0.32,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  startWorkoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.primaryGreen,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
  },
  startWorkoutPlay: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  startWorkoutText: {
    color: '#000', fontFamily: FONTS.bold, fontSize: 17,
  },

  // Flat inline stats bar (no card chrome) — icon + number on one line,
  // label beneath, separated by a thin vertical divider. Matches the
  // reference footer bar instead of the old boxed streak cards.
  statsBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: SPACING.lg, marginBottom: SPACING.lg,
    paddingVertical: SPACING.md, gap: SPACING.xl,
  },
  statItem: { alignItems: 'center' },
  statTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statValue: { color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 20 },
  statLabel: { ...BODY, color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },
  statDivider: { width: 1, height: 34, backgroundColor: COLORS.cardBorder },

  motivationCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  motivationText: { ...BODY, color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, flex: 1 },

  aiInsightsHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.sm },
  aiInsightsText: { ...BODY, color: COLORS.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: SPACING.md },
  sectionLabel: {
    ...EYEBROW, color: COLORS.textSecondary, fontSize: 11,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, marginTop: SPACING.xl,
  },
  aiToolsGrid: { flexDirection: 'row', marginHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.lg },
  aiToolBtn: {
    flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.card, padding: SPACING.md,
    borderWidth: 1, alignItems: 'center', gap: SPACING.xs,
  },
  aiToolLabel: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 12 },
  aiToolSub: { ...BODY, color: COLORS.textSecondary, fontSize: 9, textAlign: 'center', lineHeight: 13 },
});