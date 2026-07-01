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
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import Logo from '../shared/Logo';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { dashboardApi, missionApi, describeApiError } from '../../utils/api';
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

export default function DashboardScreen() {
  const { user, profile, setCnsFatigue } = useStore();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Logo size="sm" />
          {profile?.goal && (
            <View style={styles.phaseBadge}>
              <Text style={styles.phaseText}>{profile.goal.toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={styles.headerGreeting}>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.name}>{summary?.greeting || firstName}</Text>
        </View>
      </View>

      {/* ── Morning-briefing story arc ────────────────────────────────────
          1. How am I today?      → score rings (this section)
          2. What should I do?    → Workout Today card
          3. Why?                 → Today's Decision card (confidence,
                                     evidence, expandable reasoning)
          4. What's changed?      → Since Yesterday card
          5. What's my mission?   → Today's Mission card
          6. Start workout        → CTA button
          Everything below that is supporting detail the user can scroll
          into, not part of the briefing itself. ─────────────────────── */}

      {/* ── 1. How am I today? Primary score rings: Recovery + CNS Load —
          the Whoop-style centerpiece. Two large rings side by side,
          exactly mirroring how Whoop pairs Recovery % with Strain on its
          home screen. ──────────────────────────────────────────────── */}
      <View style={styles.ringsRow}>
        <ScoreRing
          size={150}
          stroke={14}
          value={recoveryScore}
          max={10}
          color={recoveryZoneColor(recoveryScore)}
          label="RECOVERY"
          sublabel={summary?.recovery?.action?.replace(/_/g, ' ').toUpperCase() || '—'}
        />
        <ScoreRing
          size={150}
          stroke={14}
          value={cnsFatigue}
          max={10}
          color={fatigueZoneColor(cnsFatigue)}
          label="CNS LOAD"
          sublabel={
            cnsFatigue >= 7 ? 'HIGH' : cnsFatigue >= 4 ? 'MODERATE' : 'FRESH'
          }
        />
      </View>

      {summary?.recovery?.message && (
        <Text style={styles.ringCaption}>{summary.recovery.message}</Text>
      )}

      {/* ── 2. What should I do? WORKOUT TODAY — first card after rings so
          the user immediately knows what to do. Most actionable info. ── */}
      {summary && (
        <View style={styles.heroCard}>
          <View style={styles.workoutTodayHeader}>
            <View style={styles.workoutTodayLabelRow}>
              <Ionicons name="barbell-outline" size={13} color={COLORS.strain} />
              <Text style={[styles.eyebrow, { color: COLORS.strain }]}>WORKOUT TODAY</Text>
            </View>
            {summary.workout_today?.rescheduled && (
              <View style={styles.rescheduledBadge}>
                <Text style={styles.rescheduledText}>RESCHEDULED</Text>
              </View>
            )}
          </View>
          <Text style={styles.workoutTodayType}>
            {summary.workout_today?.type ? summary.workout_today.type.toUpperCase() : 'NO PLAN YET'}
          </Text>
          {summary.workout_today?.type ? (
            <Text style={styles.workoutTodayMsg}>{summary.workout_today?.message}</Text>
          ) : (
            <>
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
            </>
          )}
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
          <Ionicons name="flash" size={12} color={COLORS.recoveryHigh} />
          <Text style={[styles.eyebrow, { color: COLORS.recoveryHigh }]}>TODAY'S MISSION</Text>
        </View>
        <Text style={styles.feedText}>
          {summary?.mission_text || summary?.next_task || 'Open the Coach to get your first recommendation.'}
        </Text>
        <TouchableOpacity style={styles.feedBtn} onPress={() => router.push('/(tabs)/coach')}>
          <Text style={styles.feedBtnText}>Open Coach</Text>
          <Ionicons name="arrow-forward" size={14} color={COLORS.recoveryHigh} />
        </TouchableOpacity>
      </View>

      {/* ── 6. Start workout ─────────────────────────────────────────────
          Closes the briefing loop — everything above built the case,
          this is the single action it was all leading to. ────────────── */}
      {summary?.workout_today?.type && (
        <TouchableOpacity
          style={styles.startWorkoutBtn}
          activeOpacity={0.85}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            router.push('/(tabs)/workout');
          }}
        >
          <Ionicons name="play-circle" size={22} color="#000" />
          <Text style={styles.startWorkoutText}>Start {summary.workout_today.type} Workout</Text>
        </TouchableOpacity>
      )}

      {/* ── Nutrition rings ──────────────────────────────────────────────── */}
      {summary && (
        <View style={styles.miniRingsRow}>
          <MiniRing
            pct={summary.calories_pct}
            color={COLORS.recoveryHigh}
            label="CALORIES"
            value={`${summary.calories_remaining}`}
            sub={`of ${summary.calories_target}`}
          />
          <MiniRing
            pct={summary.protein_pct}
            color={COLORS.strain}
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

      {/* Streaks */}
      {summary && (summary.workout_streak > 0 || summary.protein_streak > 0) && (
        <View style={styles.streakRow}>
          <View style={styles.streakCard}>
            <Ionicons name="flame" size={22} color={ZONE_YELLOW} />
            <Text style={styles.streakValue}>{summary.workout_streak}</Text>
            <Text style={styles.streakLabel}>WORKOUT STREAK</Text>
          </View>
          <View style={styles.streakCard}>
            <Ionicons name="nutrition" size={22} color={ZONE_GREEN} />
            <Text style={styles.streakValue}>{summary.protein_streak}</Text>
            <Text style={styles.streakLabel}>PROTEIN STREAK</Text>
          </View>
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
            <Ionicons name="arrow-forward" size={14} color={COLORS.recoveryHigh} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Phase 2: Coach Timeline ─────────────────────────────────── */}
      <CoachTimelineCard />

      {/* ── Phase 2: Program Evolution ───────────────────────────────── */}
      <ProgramEvolutionCard />

      {/* Quick Access — 3 primary actions; secondary features in AI Tools */}
      <Text style={styles.sectionLabel}>QUICK START</Text>
      <View style={styles.quickGrid}>
        <QuickBtn label="Ask Coach"  icon="chatbubble-outline"  onPress={() => router.push('/(tabs)/coach')}    accent={COLORS.recoveryHigh} />
        <QuickBtn label="Gym Mode"   icon="barbell-outline"     onPress={() => router.push('/(tabs)/workout')}  accent={COLORS.strain}       />
        <QuickBtn label="Analytics"  icon="stats-chart-outline" onPress={() => router.push('/(tabs)/progress')} accent={COLORS.sleep}        />
      </View>

      {/* Secondary feature cards — Decisions/Simulate/Form check moved off bottom nav */}
      <Text style={styles.sectionLabel}>MORE TOOLS</Text>
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

function ScoreRing({
  size, stroke, value, max, color, label, sublabel,
}: {
  size: number; stroke: number; value: number; max: number;
  color: string; label: string; sublabel: string;
}) {
  // Animate ring fill on mount (count-up effect)
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    let startTs: number | null = null;
    const duration = 900;
    const tick = (ts: number) => {
      if (!startTs) startTs = ts;
      const progress = Math.min((ts - startTs) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplayed(ease * value);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, displayed / max));
  const dashOffset = circumference * (1 - pct);

  return (
    <View style={[styles.ringWrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={COLORS.cardElevated} strokeWidth={stroke} fill="none"
        />
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
      <View style={styles.ringCenter}>
        <Text style={[styles.ringValue, { color }]}>{Math.round((displayed / max) * 100)}</Text>
        <Text style={styles.ringPercentSign}>%</Text>
      </View>
      <Text style={styles.ringLabel}>{label}</Text>
      <Text style={[styles.ringSublabel, { color }]}>{sublabel}</Text>
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

function QuickBtn({
  label, icon, onPress, accent,
}: { label: string; icon: IoniconName; onPress: () => void; accent: string }) {
  return (
    <TouchableOpacity style={[styles.quickBtn, { borderColor: alpha(accent, 0.2) }]} onPress={onPress}>
      <Ionicons name={icon} size={24} color={accent} />
      <Text style={styles.quickLabel}>{label}</Text>
    </TouchableOpacity>
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
    backgroundColor: COLORS.recoveryHigh, borderRadius: RADIUS.button,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl, marginTop: SPACING.lg,
  },
  retryText: { ...BODY, color: '#000', fontFamily: FONTS.bold, fontSize: 13 },
  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: alpha(COLORS.recoveryMed, 0.08), paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
  },
  staleBannerText: { ...BODY, color: COLORS.recoveryMed, fontSize: 11, flex: 1 },
  header: {
    padding: SPACING.xl, paddingTop: 60, gap: SPACING.md,
  },
  headerTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerGreeting: {
    gap: 2,
  },
  greeting: { ...BODY, color: COLORS.textSecondary, fontSize: 14 },
  name: { color: COLORS.text, fontFamily: FONTS.extrabold, fontSize: 24 },
  phaseBadge: { backgroundColor: alpha(COLORS.recoveryHigh, 0.1), borderRadius: RADIUS.badge, padding: SPACING.sm, marginTop: SPACING.xs },
  phaseText: { ...EYEBROW, color: COLORS.recoveryHigh, fontSize: 10, letterSpacing: 1 },

  // One shared eyebrow style for every small uppercase card/section label —
  // cards differentiate by icon + text color only, never by font treatment.
  eyebrow: { ...EYEBROW, fontSize: 10 },

  // Primary rings
  ringsRow: {
    flexDirection: 'row', justifyContent: 'center', gap: SPACING.xl,
    paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm,
  },
  ringWrap: { alignItems: 'center', justifyContent: 'center' },
  ringCenter: { alignItems: 'center', flexDirection: 'row' },
  ringValue: { fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 36 },
  ringPercentSign: { ...BODY, color: COLORS.textSecondary, fontSize: 16, fontFamily: FONTS.medium, marginLeft: 2, marginTop: 6 },
  ringLabel: {
    ...EYEBROW, position: 'absolute', bottom: -20, color: COLORS.textSecondary,
    fontSize: 11,
  },
  ringSublabel: {
    ...EYEBROW, position: 'absolute', bottom: -36, fontSize: 10, letterSpacing: 0.5,
  },
  ringCaption: {
    ...BODY, color: COLORS.textSecondary, fontSize: 12, textAlign: 'center',
    marginTop: SPACING.xl, marginBottom: SPACING.sm, paddingHorizontal: SPACING.xxl, lineHeight: 17,
  },

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
  feedText: { ...BODY, color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: SPACING.md },
  workoutTodayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  workoutTodayLabelRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  workoutTodayType: {
    color: COLORS.text, fontFamily: FONTS.extrabold, fontSize: 24, letterSpacing: 0.5,
    marginBottom: SPACING.xs,
  },
  workoutTodayMsg: {
    ...BODY, color: COLORS.textSecondary, fontSize: 13, lineHeight: 19,
  },
  feedBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, alignSelf: 'flex-start' },
  feedBtnText: { color: COLORS.recoveryHigh, fontFamily: FONTS.semibold, fontSize: 13 },

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
    backgroundColor: COLORS.primaryGreen, borderRadius: RADIUS.button,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    alignSelf: 'flex-start', marginTop: SPACING.sm,
  },
  generatePlanBtnText: { color: '#000', fontFamily: FONTS.bold, fontSize: 13 },

  // Single primary CTA that closes the briefing — the brightest surface
  // on the screen on purpose, so it reads as the one clear next action.
  startWorkoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.strainGlow, borderRadius: RADIUS.card,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.lg, paddingVertical: SPACING.lg,
  },
  startWorkoutText: { color: '#000', fontFamily: FONTS.extrabold, fontSize: 15, letterSpacing: 0.3, textTransform: 'capitalize' },

  streakRow: { flexDirection: 'row', marginHorizontal: SPACING.lg, marginBottom: SPACING.md, gap: SPACING.sm },
  streakCard: {
    flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.card, padding: SPACING.md,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder,
  },
  streakValue: { color: COLORS.text, fontFamily: FONTS.numericBold, fontVariant: ['tabular-nums'], fontSize: 22, marginTop: SPACING.xs },
  streakLabel: { ...EYEBROW, color: COLORS.textSecondary, fontSize: 9, letterSpacing: 0.5, marginTop: 2 },

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
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.md },
  aiToolsGrid: { flexDirection: 'row', marginHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.lg },
  aiToolBtn: {
    flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.card, padding: SPACING.md,
    borderWidth: 1, alignItems: 'center', gap: SPACING.xs,
  },
  aiToolLabel: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 12 },
  aiToolSub: { ...BODY, color: COLORS.textSecondary, fontSize: 9, textAlign: 'center', lineHeight: 13 },
  quickBtn: {
    width: '47%', backgroundColor: COLORS.card, borderRadius: RADIUS.card, padding: SPACING.lg,
    borderWidth: 1, alignItems: 'center', gap: SPACING.sm,
  },
  quickLabel: { color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 13 },
});