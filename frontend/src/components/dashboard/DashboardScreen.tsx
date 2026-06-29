// VYRN — Mission Control Dashboard
//
// Visual language rebuilt to match Whoop's actual UI grammar (verified
// against real product screenshots, not a generic dark-fitness-app guess):
// large circular score rings as the primary metric unit, color-coded by
// zone (green = good, yellow = moderate, red = needs attention), stacked
// as scrollable cards on a true-black background with minimal chrome.
// Data wiring is unchanged from the previous version — still calls the
// real GET /api/dashboard/summary endpoint with proper loading/error states.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import Logo from '../shared/Logo';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { dashboardApi, missionApi, describeApiError } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS, recoveryColor as whoopRecoveryColor } from '../../theme/colors';
import ProactiveBriefCard from './ProactiveBriefCard';
import PatternInsightsCard from './PatternInsightsCard';

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

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName =
    user?.full_name?.split(' ')[0] || profile?.full_name?.split(' ')[0] || 'Athlete';

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator color={COLORS.recoveryHigh} size="large" />
        <Text style={styles.loadingLabel}>Loading your mission...</Text>
      </View>
    );
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

      {/* ── Primary score rings row: Recovery + CNS Load — the Whoop-style
          centerpiece. Two large rings side by side, exactly mirroring how
          Whoop pairs Recovery % with Strain on its home screen. ──────── */}
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

      {/* ── WORKOUT TODAY — first card after rings so the user immediately
          knows what to do. This is the most actionable info. ────────── */}
      {summary && (
        <View style={styles.workoutTodayCard}>
          <View style={styles.workoutTodayHeader}>
            <View style={styles.workoutTodayLabelRow}>
              <Ionicons name="barbell-outline" size={13} color={COLORS.strain} />
              <Text style={styles.workoutTodayLabel}>WORKOUT TODAY</Text>
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
                onPress={() => router.push('/(tabs)/coach')}
              >
                <Ionicons name="flash" size={14} color="#000" />
                <Text style={styles.generatePlanBtnText}>Generate Workout</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Daily Mission */}
      <View style={styles.feedCard}>
        <View style={styles.feedLabelRow}>
          <Ionicons name="flash" size={12} color={COLORS.recoveryHigh} />
          <Text style={styles.feedLabel}>TODAY'S MISSION</Text>
        </View>
        <Text style={styles.feedText}>
          {summary?.mission_text || summary?.next_task || 'Open the Coach to get your first recommendation.'}
        </Text>
        <TouchableOpacity style={styles.feedBtn} onPress={() => router.push('/(tabs)/coach')}>
          <Text style={styles.feedBtnText}>Open Coach</Text>
          <Ionicons name="arrow-forward" size={14} color={COLORS.recoveryHigh} />
        </TouchableOpacity>
      </View>

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
            color="#3CA7FF"
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
        <View style={styles.aiInsightsCard}>
          <View style={styles.aiInsightsHeader}>
            <Ionicons name="sparkles" size={13} color={COLORS.strainGlow} />
            <Text style={styles.aiInsightsLabel}>AI INSIGHTS</Text>
          </View>
          <Text style={styles.aiInsightsText}>{summary.motivation_message}</Text>
          <TouchableOpacity style={styles.feedBtn} onPress={() => router.push('/(tabs)/coach')}>
            <Text style={styles.feedBtnText}>Ask Coach</Text>
            <Ionicons name="arrow-forward" size={14} color={COLORS.recoveryHigh} />
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.sectionLabel}>QUICK START</Text>
      <View style={styles.quickGrid}>
        <QuickBtn label="Ask Coach" icon="chatbubble-outline" onPress={() => router.push('/(tabs)/coach')} accent={COLORS.recoveryHigh} />
        <QuickBtn label="Gym Mode" icon="barbell-outline" onPress={() => router.push('/(tabs)/workout')} accent={COLORS.strain} />
        <QuickBtn label="Progress" icon="stats-chart-outline" onPress={() => router.push('/(tabs)/progress')} accent={COLORS.recoveryMed} />
        <QuickBtn label="My PRs" icon="trophy-outline" onPress={() => router.push('/(tabs)/prs')} accent={COLORS.sleep} />
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
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value / max));
  const dashOffset = circumference * (1 - pct);

  return (
    <View style={[styles.ringWrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke="#161616" strokeWidth={stroke} fill="none"
        />
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          // Rotate so the ring starts at 12 o'clock, matching Whoop's
          // convention, instead of SVG's default 3 o'clock start.
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={[styles.ringValue, { color }]}>{Math.round((value / max) * 100)}</Text>
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
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#161616" strokeWidth={stroke} fill="none" />
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
    <TouchableOpacity style={[styles.quickBtn, { borderColor: accent + '33' }]} onPress={onPress}>
      <Ionicons name={icon} size={24} color={accent} />
      <Text style={styles.quickLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  centerContainer: {
    flex: 1, backgroundColor: '#000000',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  loadingLabel: { color: '#5C6B6E', fontSize: 13, marginTop: 14 },
  errorTitle: { color: '#FFF', fontSize: 17, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  errorBody: { color: '#5C6B6E', fontSize: 13, marginTop: 8, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.recoveryHigh, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 24, marginTop: 20,
  },
  retryText: { color: '#000', fontSize: 13, fontWeight: '700' },
  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1A1606', paddingVertical: 8, paddingHorizontal: 16,
  },
  staleBannerText: { color: COLORS.recoveryMed, fontSize: 11, flex: 1 },
  header: {
    padding: 24, paddingTop: 60, gap: 12,
  },
  headerTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerGreeting: {
    gap: 2,
  },
  greeting: { color: '#5C6B6E', fontSize: 14 },
  name: { color: '#FFF', fontSize: 24, fontWeight: '800' },
  phaseBadge: { backgroundColor: '#0E1F1A', borderRadius: 8, padding: 8, marginTop: 4 },
  phaseText: { color: COLORS.recoveryHigh, fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  // Primary rings
  ringsRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 20,
    paddingHorizontal: 16, marginBottom: 8,
  },
  ringWrap: { alignItems: 'center', justifyContent: 'center' },
  ringCenter: { alignItems: 'center', flexDirection: 'row' },
  ringValue: { fontSize: 36, fontWeight: '800' },
  ringPercentSign: { color: '#5C6B6E', fontSize: 16, fontWeight: '600', marginLeft: 2, marginTop: 6 },
  ringLabel: {
    position: 'absolute', bottom: -20, color: '#5C6B6E',
    fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
  },
  ringSublabel: {
    position: 'absolute', bottom: -36, fontSize: 10, fontWeight: '700', letterSpacing: 0.5,
  },
  ringCaption: {
    color: '#7A8A8E', fontSize: 12, textAlign: 'center',
    marginTop: 28, marginBottom: 8, paddingHorizontal: 32, lineHeight: 17,
  },

  feedCard: {
    margin: 16, marginTop: 16,
    backgroundColor: '#0C1714', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#16352A',
  },
  feedLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  feedLabel: { color: COLORS.recoveryHigh, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  feedText: { color: '#C8D2D4', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  // Workout Today card (moved to top — Priority 2)
  workoutTodayCard: {
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: COLORS.card, borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: COLORS.strain + '40',
  },
  workoutTodayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  workoutTodayLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  workoutTodayLabel: {
    color: COLORS.strain, fontSize: 10, fontWeight: '800', letterSpacing: 1.5,
  },
  workoutTodayType: {
    color: COLORS.text, fontSize: 24, fontWeight: '800', letterSpacing: 0.5,
    marginBottom: 6,
  },
  workoutTodayMsg: {
    color: COLORS.textSecondary, fontSize: 13, lineHeight: 19,
  },
  feedBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  feedBtnText: { color: COLORS.recoveryHigh, fontSize: 13, fontWeight: '600' },

  // Mini rings (nutrition)
  miniRingsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    marginHorizontal: 16, marginBottom: 16, marginTop: 8,
  },
  miniRingWrap: { alignItems: 'center', width: 90 },
  miniRingValue: { color: '#FFF', fontSize: 13, fontWeight: '800', marginTop: 8 },
  miniRingLabel: { color: '#5C6B6E', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  miniRingSub: { color: '#3F4A4C', fontSize: 9, marginTop: 1 },

  card: {
    backgroundColor: '#0E0E0E', borderRadius: 16, padding: 16,
    marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#1C1C1C',
  },
  cardLabel: { color: '#5C6B6E', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  cardMessage: { color: '#C8D2D4', fontSize: 13, lineHeight: 19, marginTop: 4 },
  workoutRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  workoutType: { color: '#FFF', fontSize: 16, fontWeight: '700', flex: 1 },
  rescheduledBadge: { backgroundColor: '#1A1606', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8 },
  rescheduledText: { color: COLORS.recoveryMed, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  generatePlanBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primaryGreen, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14,
    alignSelf: 'flex-start', marginTop: 10,
  },
  generatePlanBtnText: { color: '#000', fontSize: 13, fontWeight: '700' },

  streakRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, gap: 10 },
  streakCard: {
    flex: 1, backgroundColor: '#0E0E0E', borderRadius: 14, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#1C1C1C',
  },
  streakValue: { color: '#FFF', fontSize: 22, fontWeight: '800', marginTop: 4 },
  streakLabel: { color: '#5C6B6E', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },

  motivationCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#0E0E0E', borderRadius: 14,
    marginHorizontal: 16, marginBottom: 12, padding: 14,
    borderWidth: 1, borderColor: '#1C1C1C',
  },
  motivationText: { color: '#C8D2D4', fontSize: 13, lineHeight: 19, flex: 1 },

  aiInsightsCard: {
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: '#0A0F0A', borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: COLORS.strainGlow + '30',
  },
  aiInsightsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  aiInsightsLabel: { color: COLORS.strainGlow, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  aiInsightsText: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 12 },
  sectionLabel: {
    color: '#5C6B6E', fontSize: 11, fontWeight: '700', letterSpacing: 1.5,
    marginHorizontal: 16, marginBottom: 8, marginTop: 8,
  },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 16, gap: 8, marginBottom: 12 },
  quickBtn: {
    width: '47%', backgroundColor: '#0E0E0E', borderRadius: 14, padding: 16,
    borderWidth: 1, alignItems: 'center', gap: 6,
  },
  quickLabel: { color: '#C0C0C0', fontSize: 13, fontWeight: '600' },
});
