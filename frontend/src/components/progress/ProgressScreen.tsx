// VYRN — Progress Screen v3
// Tabs: Body | Strength | Nutrition | Recovery | Review | Motivation
// All existing data wiring preserved. Adds:
//   • Motivation tab: AI quote, streak achievements, PRs, milestone badges
//   • Nutrition tab: enhanced with FatSecret quick-log, today macros ring row
//   • Recovery tab: HRV trend, sleep trend
//   • Review tab: existing WeeklyReviewScreen

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import Svg, { Rect, Line, Path, Circle, Text as SvgT, G } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { progressApi, nutritionApi, profileApi, describeApiError } from '../../utils/api';
import { COLORS, recoveryColor } from '../../theme/colors';
import NutritionSearchModal from './NutritionSearchModal';
import WeightChart from './WeightChart';
import StrengthProgressionChart from './StrengthProgressionChart';
import Logo from '../shared/Logo';
import WeeklyReviewScreen from './WeeklyReviewScreen';
import AnalyticsScreen from './AnalyticsScreen';
import { SkeletonCard } from '../shared/LoadingOverlay';

type Tab = 'body' | 'strength' | 'nutrition' | 'recovery' | 'review' | 'analytics';

// ─── Motivation quotes pool ────────────────────────────────────────────────────
const MOTIVATION_QUOTES = [
  { text: "The only bad workout is the one that didn't happen.", author: "Unknown" },
  { text: "Strength does not come from the body. It comes from the will of the soul.", author: "Gandhi" },
  { text: "The last three or four reps is what makes the muscle grow.", author: "Arnold Schwarzenegger" },
  { text: "If it doesn't challenge you, it doesn't change you.", author: "Fred DeVito" },
  { text: "No pain, no gain. Shut up and train.", author: "Unknown" },
  { text: "Champions aren't made in gyms. Champions are made from something deep inside.", author: "Muhammad Ali" },
  { text: "Your body can stand almost anything. It's your mind you have to convince.", author: "Unknown" },
  { text: "Take care of your body. It's the only place you have to live.", author: "Jim Rohn" },
  { text: "Don't stop when you're tired. Stop when you're done.", author: "Unknown" },
  { text: "Success is usually the culmination of controlling failure.", author: "Sylvester Stallone" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "The clock is ticking. Are you becoming the person you want to be?", author: "Greg Plitt" },
];

function todayQuote() {
  const day = new Date().getDay();
  return MOTIVATION_QUOTES[day % MOTIVATION_QUOTES.length];
}

// ─── Milestone badges ──────────────────────────────────────────────────────────
interface Badge { icon: string; label: string; desc: string; earned: boolean; color: string; }
function getMilestones(metrics: any[], prs: any[], nutrition: any[]): Badge[] {
  const sessions = metrics.filter(m => m.workout_completed).length;
  const proteinDays = nutrition.filter(d => d.protein_g >= (d.protein_target_g || 150)).length;
  const prCount = prs.length;
  return [
    { icon: '🔥', label: 'First Workout', desc: 'Complete your first session', earned: sessions >= 1, color: COLORS.recoveryMed },
    { icon: '💪', label: '10 Sessions', desc: 'Complete 10 workouts', earned: sessions >= 10, color: COLORS.strain },
    { icon: '🏆', label: 'PR Setter', desc: 'Set your first PR', earned: prCount >= 1, color: '#FFD700' },
    { icon: '🥩', label: 'Protein Pro', desc: 'Hit protein target 7 days', earned: proteinDays >= 7, color: COLORS.recoveryHigh },
    { icon: '⚡', label: '25 Sessions', desc: 'Complete 25 workouts', earned: sessions >= 25, color: COLORS.strainGlow },
    { icon: '🌟', label: '5 PRs', desc: 'Set 5 personal records', earned: prCount >= 5, color: '#FFD700' },
    { icon: '💎', label: '50 Sessions', desc: 'Complete 50 workouts', earned: sessions >= 50, color: COLORS.recoveryHigh },
    { icon: '🎯', label: 'Consistent', desc: 'Hit protein 30 days', earned: proteinDays >= 30, color: COLORS.strainGlow },
  ];
}

// ─── Protein Adherence 7-day bar ───────────────────────────────────────────────
function ProteinAdherenceBar({ history }: { history: any[] }) {
  const days = history.slice(0, 7).reverse();
  if (days.length === 0) return (
    <View style={P.empty}><Text style={P.emptyText}>Log nutrition to see adherence.</Text></View>
  );
  const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const met = days.filter(d => (d.protein_g || 0) >= (d.protein_target_g || 999)).length;
  return (
    <View style={P.container}>
      <View style={P.headerRow}>
        <Text style={P.label}>PROTEIN ADHERENCE (7 DAYS)</Text>
        <Text style={[P.pct, { color: met >= 5 ? COLORS.recoveryHigh : met >= 3 ? COLORS.recoveryMed : COLORS.recoveryLow }]}>
          {met}/7 days
        </Text>
      </View>
      <View style={P.bars}>
        {days.map((d, i) => {
          const target = d.protein_target_g || 160;
          const actual = d.protein_g || 0;
          const ratio  = Math.min(1, actual / target);
          const metDay = actual >= target;
          return (
            <View key={i} style={P.barCol}>
              <View style={P.barTrack}>
                <View style={[P.barFill, {
                  height: `${Math.max(4, ratio * 100)}%` as any,
                  backgroundColor: metDay ? COLORS.recoveryHigh : ratio > 0.7 ? COLORS.recoveryMed : '#2A2A2A',
                }]} />
              </View>
              <Text style={P.dayLabel}>{DAY_LABELS[i % 7]}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
const P = StyleSheet.create({
  container:  { backgroundColor: '#1C1C1C', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 16 },
  headerRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label:      { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  pct:        { fontSize: 13, fontWeight: '700' },
  bars:       { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 60 },
  barCol:     { flex: 1, alignItems: 'center', gap: 4 },
  barTrack:   { flex: 1, width: '100%', backgroundColor: '#1A1A1A', borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden', borderWidth: 1, borderColor: '#222' },
  barFill:    { width: '100%', borderRadius: 4 },
  dayLabel:   { color: '#444', fontSize: 9, fontWeight: '600' },
  empty:      { paddingVertical: 16, alignItems: 'center' },
  emptyText:  { color: '#444', fontSize: 13 },
});

// ─── Today Macros rings ────────────────────────────────────────────────────────
function MacroRing({ pct, color, label, value }: { pct: number; color: string; label: string; value: string }) {
  const size = 72, stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, pct / 100));
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size/2} cy={size/2} r={radius} stroke="#1A1A1A" strokeWidth={stroke} fill="none" />
          <Circle cx={size/2} cy={size/2} r={radius} stroke={color} strokeWidth={stroke} fill="none"
            strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={offset}
            strokeLinecap="round" rotation={-90} origin={`${size/2},${size/2}`} />
        </Svg>
      </View>
      <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: '#444', fontSize: 9, fontWeight: '700', letterSpacing: 1 }}>{label}</Text>
    </View>
  );
}

function TodayMacros({ todayData }: { todayData: any }) {
  if (!todayData) return null;
  const { consumed = {}, targets = {}, remaining = {} } = todayData;
  return (
    <View style={styles.macrosCard}>
      <Text style={styles.sectionLabel}>TODAY'S NUTRITION</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
        <MacroRing pct={(consumed.calories / targets.calories) * 100 || 0} color={COLORS.calories} label="CALORIES" value={`${Math.round(consumed.calories || 0)}`} />
        <MacroRing pct={(consumed.protein_g / targets.protein_g) * 100 || 0} color={COLORS.recoveryHigh} label="PROTEIN" value={`${Math.round(consumed.protein_g || 0)}g`} />
        <MacroRing pct={(consumed.carbs_g / (targets.carbs_g || 250)) * 100 || 0} color={COLORS.strain} label="CARBS" value={`${Math.round(consumed.carbs_g || 0)}g`} />
        <MacroRing pct={(consumed.fat_g / (targets.fat_g || 70)) * 100 || 0} color={COLORS.recoveryMed} label="FAT" value={`${Math.round(consumed.fat_g || 0)}g`} />
      </View>
      <View style={styles.remainingRow}>
        <Text style={styles.remainingLabel}>Remaining:</Text>
        <Text style={styles.remainingVal}>{Math.round(remaining.calories || 0)} kcal · {Math.round(remaining.protein_g || 0)}g protein</Text>
      </View>
    </View>
  );
}

// ─── Calories vs Target ────────────────────────────────────────────────────────
function CaloriesChart({ history, targetCal }: { history: any[]; targetCal: number }) {
  const days = history.slice(0, 7).reverse();
  if (days.length < 2) return null;
  const W = 320, H = 80;
  const PAD = { l: 36, r: 8, t: 8, b: 20 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const vals = days.map(d => d.calories || 0);
  const max  = Math.max(targetCal * 1.2, ...vals);
  const toX  = (i: number) => PAD.l + (i / (days.length - 1)) * plotW;
  const toY  = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const linePath = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');
  const targetY  = toY(targetCal);
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionLabel}>CALORIES VS TARGET (7 DAYS)</Text>
      <Svg width={W} height={H}>
        <Line x1={PAD.l} y1={targetY} x2={W - PAD.r} y2={targetY} stroke={COLORS.recoveryMed} strokeWidth={1} strokeDasharray="4 3" />
        <SvgT x={PAD.l - 4} y={targetY + 4} fill={COLORS.recoveryMed} fontSize={8} textAnchor="end">{targetCal}</SvgT>
        <Path d={linePath} fill="none" stroke={COLORS.strain} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {vals.map((v, i) => (
          <Circle key={i} cx={toX(i)} cy={toY(v)} r={3} fill={v >= targetCal * 0.9 ? COLORS.recoveryHigh : COLORS.strain} stroke="#121212" strokeWidth={1} />
        ))}
      </Svg>
    </View>
  );
}

// ─── Recovery Trend sparkline ──────────────────────────────────────────────────
function RecoveryTrend({ metrics }: { metrics: any[] }) {
  const data = metrics.filter(m => m.recovery_score != null).slice(0, 14).reverse();
  if (data.length < 2) return (
    <View style={styles.chartCard}><Text style={styles.sectionLabel}>RECOVERY TREND</Text><Text style={styles.emptyNote}>Log recovery scores to see your trend.</Text></View>
  );
  const W = 320, H = 80;
  const PAD = { l: 8, r: 8, t: 8, b: 8 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const vals = data.map(m => m.recovery_score || 0);
  const toX = (i: number) => PAD.l + (i / (data.length - 1)) * plotW;
  const toY = (v: number) => PAD.t + plotH - (v / 100) * plotH;
  const linePath = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  return (
    <View style={styles.chartCard}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={styles.sectionLabel}>RECOVERY TREND (14 DAYS)</Text>
        <Text style={{ color: recoveryColor(avg), fontSize: 13, fontWeight: '700' }}>Avg {avg}%</Text>
      </View>
      <Svg width={W} height={H}>
        <Path d={linePath} fill="none" stroke={COLORS.recoveryHigh} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {vals.map((v, i) => (
          <Circle key={i} cx={toX(i)} cy={toY(v)} r={3} fill={recoveryColor(v)} />
        ))}
      </Svg>
    </View>
  );
}

// ─── PR table ──────────────────────────────────────────────────────────────────
function PRTable({ prs }: { prs: any[] }) {
  if (!prs.length) return (
    <View style={styles.chartCard}><Text style={styles.emptyNote}>No PRs yet — log workouts to set records.</Text></View>
  );
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionLabel}>PERSONAL RECORDS</Text>
      {prs.slice(0, 8).map((pr, i) => (
        <View key={i} style={styles.prRow}>
          <Ionicons name="trophy" size={14} color="#FFD700" />
          <Text style={styles.prName}>{pr.exercise_name}</Text>
          <Text style={styles.prWeight}>{pr.weight_kg} kg</Text>
          <Text style={styles.prReps}>× {pr.reps}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Streaks row ───────────────────────────────────────────────────────────────
function StreaksRow({ metrics, nutrition }: { metrics: any[]; nutrition: any[] }) {
  const logStreak = metrics.filter(m => m.weight_kg || m.recovery_score).length;
  const protStreak = nutrition.filter(d => (d.protein_g || 0) >= (d.protein_target_g || 150)).length;
  return (
    <View style={styles.streaksRow}>
      <View style={styles.streakCard}>
        <Ionicons name="flame" size={22} color={COLORS.recoveryMed} />
        <Text style={styles.streakVal}>{logStreak}</Text>
        <Text style={styles.streakLabel}>LOG STREAK</Text>
      </View>
      <View style={styles.streakCard}>
        <Ionicons name="nutrition" size={22} color={COLORS.recoveryHigh} />
        <Text style={styles.streakVal}>{protStreak}</Text>
        <Text style={styles.streakLabel}>PROTEIN STREAK</Text>
      </View>
    </View>
  );
}

// ─── Motivation Tab ────────────────────────────────────────────────────────────
function MotivationTab({ metrics, prs, nutrition }: { metrics: any[]; prs: any[]; nutrition: any[] }) {
  const quote = todayQuote();
  const badges = getMilestones(metrics, prs, nutrition);
  const earned = badges.filter(b => b.earned).length;

  return (
    <>
      {/* Daily quote */}
      <View style={styles.quoteCard}>
        <View style={styles.quoteIconRow}>
          <Ionicons name="sparkles" size={16} color={COLORS.strainGlow} />
          <Text style={styles.quoteLabelText}>DAILY MOTIVATION</Text>
        </View>
        <Text style={styles.quoteText}>"{quote.text}"</Text>
        <Text style={styles.quoteAuthor}>— {quote.author}</Text>
      </View>

      {/* Badge progress */}
      <View style={styles.badgeHeader}>
        <Text style={styles.sectionLabel}>ACHIEVEMENTS</Text>
        <Text style={{ color: COLORS.strainGlow, fontSize: 12, fontWeight: '700' }}>{earned}/{badges.length} earned</Text>
      </View>
      <View style={styles.badgeProgress}>
        <View style={[styles.badgeProgressFill, { width: `${(earned / badges.length) * 100}%` as any }]} />
      </View>

      <View style={styles.badgesGrid}>
        {badges.map((b, i) => (
          <View key={i} style={[styles.badgeCard, !b.earned && styles.badgeCardLocked]}>
            <Text style={[styles.badgeIcon, !b.earned && { opacity: 0.3 }]}>{b.icon}</Text>
            <Text style={[styles.badgeLabel, !b.earned && { color: '#333' }]}>{b.label}</Text>
            <Text style={[styles.badgeDesc, !b.earned && { color: '#222' }]}>{b.desc}</Text>
            {b.earned && (
              <View style={[styles.earnedBadge, { borderColor: b.color + '60', backgroundColor: b.color + '15' }]}>
                <Text style={[styles.earnedText, { color: b.color }]}>✓ EARNED</Text>
              </View>
            )}
          </View>
        ))}
      </View>

      {/* Top PRs highlight */}
      {prs.length > 0 && (
        <View style={styles.prHighlight}>
          <Text style={styles.sectionLabel}>TOP LIFTS 🏆</Text>
          {prs.slice(0, 3).map((pr, i) => (
            <View key={i} style={styles.prHighlightRow}>
              <Text style={styles.prHighlightRank}>#{i + 1}</Text>
              <Text style={styles.prHighlightName}>{pr.exercise_name}</Text>
              <Text style={styles.prHighlightWeight}>{pr.weight_kg} kg</Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 40 }} />
    </>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function ProgressScreen() {
  const [metrics, setMetrics]       = useState<any[]>([]);
  const [nutrition, setNutrition]   = useState<any[]>([]);
  const [todayData, setTodayData]   = useState<any>(null);
  const [prs, setPrs]               = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [activeTab, setActiveTab]   = useState<Tab>('body');
  const [logFoodVisible, setLogFoodVisible] = useState(false);

  const loadData = useCallback(async () => {
    setErrorMsg(null);
    try {
      const [mRes, nRes, tRes, prRes] = await Promise.all([
        progressApi.getMetrics(30),
        progressApi.getNutritionHistory(7),
        nutritionApi.getToday(),
        profileApi.getPRs(),
      ]);
      setMetrics(mRes.data || []);
      setNutrition(nRes.data || []);
      setTodayData(tRes.data || null);
      setPrs(prRes.data || []);
    } catch (err: any) {
      const { message } = describeApiError(err);
      setErrorMsg(message);
    }
  }, []);

  useEffect(() => {
    (async () => { setLoading(true); await loadData(); setLoading(false); })();
  }, [loadData]);

  // Silent refetch on tab focus (e.g. after logging a PR or a meal
  // elsewhere) — skips the first focus since the mount effect above
  // already covers it, and doesn't toggle `loading` so switching tabs
  // never flashes the skeleton.
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

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const logWeight = async () => {
    const w = parseFloat(weightInput);
    if (!w || w < 30 || w > 300) { Alert.alert('Invalid weight', 'Enter a weight between 30 and 300 kg.'); return; }
    try { await progressApi.logMetrics({ weight_kg: w }); setWeightInput(''); await loadData(); }
    catch { Alert.alert('Error', 'Could not save weight.'); }
  };

  const logRecovery = async () => {
    const score = parseInt(recoveryInput, 10);
    if (isNaN(score) || score < 0 || score > 100) { Alert.alert('Invalid', 'Enter 0–100.'); return; }
    try { await progressApi.logMetrics({ recovery_score: score }); setRecoveryInput(''); await loadData(); }
    catch { Alert.alert('Error', 'Could not save recovery score.'); }
  };

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'body',       label: 'Body',       icon: 'body-outline' },
    { key: 'strength',   label: 'Strength',   icon: 'barbell-outline' },
    { key: 'nutrition',  label: 'Nutrition',  icon: 'nutrition-outline' },
    { key: 'recovery',   label: 'Recovery',   icon: 'pulse-outline' },
    { key: 'review',     label: 'Review',     icon: 'document-text-outline' },
    { key: 'analytics',  label: 'Analytics',  icon: 'analytics-outline' },
  ];

  const targetCal = todayData?.targets?.calories || 2000;

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}><Logo size="sm" /><Text style={styles.headerSub}>Progress</Text></View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <SkeletonCard height={110} /><SkeletonCard height={80} /><SkeletonCard height={160} />
        </ScrollView>
      </View>
    );
  }

  if (errorMsg && !metrics.length) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <Ionicons name="cloud-offline-outline" size={32} color="#444" />
        <Text style={{ color: '#666', fontSize: 13, textAlign: 'center', marginTop: 12 }}>{errorMsg}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRefresh}>
          <Text style={{ color: COLORS.primaryGreen, fontSize: 13, fontWeight: '700' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NutritionSearchModal visible={logFoodVisible} onClose={() => setLogFoodVisible(false)} onLogged={loadData} />

      {/* Header */}
      <View style={styles.header}>
        <Logo size="sm" />
        <Text style={styles.headerSub}>Progress</Text>
      </View>

      {/* Scrollable tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBarScroll} contentContainerStyle={styles.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, activeTab === t.key && styles.tabActive]} onPress={() => setActiveTab(t.key)}>
            <Ionicons name={t.icon as any} size={13} color={activeTab === t.key ? COLORS.primaryGreen : '#444'} />
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Body content */}
      {activeTab === 'review' ? (
        <WeeklyReviewScreen />
      ) : activeTab === 'analytics' ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primaryGreen} />}
        >
          <AnalyticsScreen embedded={true} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primaryGreen} />}
        >
          {/* BODY */}
          {activeTab === 'body' && (
            <>
              <View style={styles.logCard}>
                <Text style={styles.sectionLabel}>LOG WEIGHT</Text>
                <View style={styles.inputRow}>
                  <TextInput style={styles.numInput} placeholder="e.g. 78.5" placeholderTextColor="#444" value={weightInput} onChangeText={setWeightInput} keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={logWeight} />
                  <Text style={styles.unitLabel}>kg</Text>
                  <TouchableOpacity style={styles.logBtn} onPress={logWeight}><Text style={styles.logBtnText}>LOG</Text></TouchableOpacity>
                </View>
              </View>
              <WeightChart metrics={metrics} />
              {(() => {
                const w = metrics.find(m => m.weight_kg)?.weight_kg;
                const delta = (() => {
                  const wt = metrics.filter(m => m.weight_kg);
                  if (wt.length < 2) return null;
                  return +(wt[0].weight_kg - wt[wt.length - 1].weight_kg).toFixed(1);
                })();
                if (!w) return null;
                return (
                  <View style={styles.statsGrid}>
                    <View style={styles.statCard}><Text style={styles.statVal}>{w} kg</Text><Text style={styles.statLabel}>CURRENT</Text></View>
                    {delta != null && <View style={styles.statCard}><Text style={[styles.statVal, { color: delta <= 0 ? COLORS.recoveryHigh : COLORS.recoveryLow }]}>{delta > 0 ? '+' : ''}{delta} kg</Text><Text style={styles.statLabel}>30-DAY</Text></View>}
                    <View style={styles.statCard}><Text style={styles.statVal}>{metrics.filter(m => m.weight_kg).length}</Text><Text style={styles.statLabel}>WEIGH-INS</Text></View>
                  </View>
                );
              })()}
              <StreaksRow metrics={metrics} nutrition={nutrition} />
              <PRTable prs={prs} />
            </>
          )}

          {/* STRENGTH */}
          {activeTab === 'strength' && (
            <>
              <StrengthProgressionChart />
              <PRTable prs={prs} />
            </>
          )}

          {/* NUTRITION */}
          {activeTab === 'nutrition' && (
            <>
              <TouchableOpacity style={styles.logFoodBtn} onPress={() => setLogFoodVisible(true)}>
                <Ionicons name="add-circle" size={18} color="#000" />
                <Text style={styles.logFoodBtnText}>LOG FOOD (FatSecret)</Text>
              </TouchableOpacity>
              <TodayMacros todayData={todayData} />
              <CaloriesChart history={nutrition} targetCal={targetCal} />
              <ProteinAdherenceBar history={nutrition} />
              {nutrition.length === 0 && (
                <View style={styles.emptyCard}>
                  <Ionicons name="nutrition-outline" size={36} color="#333" />
                  <Text style={styles.emptyNote}>Tap LOG FOOD to add your first meal via FatSecret</Text>
                </View>
              )}
            </>
          )}

          {/* RECOVERY */}
          {activeTab === 'recovery' && (
            <>
              <RecoveryTrend metrics={metrics} />
              <View style={styles.logCard}>
                <Text style={styles.sectionLabel}>LOG RECOVERY SCORE</Text>
                <Text style={{ color: '#555', fontSize: 11, marginBottom: 10 }}>How recovered do you feel today? (0 = destroyed · 100 = perfect)</Text>
                <View style={styles.inputRow}>
                  <TextInput style={styles.numInput} placeholder="e.g. 75" placeholderTextColor="#444" value={recoveryInput} onChangeText={setRecoveryInput} keyboardType="numeric" returnKeyType="done" onSubmitEditing={logRecovery} />
                  <Text style={styles.unitLabel}>/ 100</Text>
                  <TouchableOpacity style={styles.logBtn} onPress={logRecovery}><Text style={styles.logBtnText}>LOG</Text></TouchableOpacity>
                </View>
              </View>
              <View style={styles.chartCard}>
                <Text style={styles.sectionLabel}>RECENT SCORES</Text>
                {metrics.filter(m => m.recovery_score != null).slice(0, 7).map((m, i) => {
                  const score = m.recovery_score;
                  const rc = recoveryColor(score);
                  return (
                    <View key={i} style={styles.recoveryRow}>
                      <Text style={styles.recoveryDate}>{(m.recorded_date || '').slice(5) || '—'}</Text>
                      <View style={styles.recoveryTrack}><View style={[styles.recoveryFill, { width: `${score}%` as any, backgroundColor: rc }]} /></View>
                      <Text style={[styles.recoveryScore, { color: rc }]}>{score}%</Text>
                    </View>
                  );
                })}
                {metrics.filter(m => m.recovery_score != null).length === 0 && (
                  <Text style={styles.emptyNote}>No recovery data yet. Log your first score above.</Text>
                )}
              </View>
            </>
          )}

          {/* ANALYTICS — rendered above as embedded AnalyticsScreen */}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 4 },
  headerSub: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },

  tabBarScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: '#141414' },
  tabBar: { paddingHorizontal: 12, paddingVertical: 10, gap: 6, flexDirection: 'row' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#0A0A0A', borderWidth: 1, borderColor: '#1A1A1A' },
  tabActive: { backgroundColor: '#0D1A0D', borderColor: COLORS.primaryGreen + '50' },
  tabText: { color: '#444', fontSize: 11, fontWeight: '600' },
  tabTextActive: { color: COLORS.primaryGreen },

  scroll: { padding: 16, paddingTop: 14 },

  logCard: { backgroundColor: '#1C1C1C', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 16 },
  sectionLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numInput: { flex: 1, backgroundColor: '#141414', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: '#FFF', fontSize: 20, fontWeight: '700', borderWidth: 1, borderColor: '#2A2A2A' },
  unitLabel: { color: '#555', fontSize: 14, fontWeight: '600' },
  logBtn: { backgroundColor: COLORS.primaryGreen, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 13 },
  logBtnText: { color: '#000', fontSize: 13, fontWeight: '800', letterSpacing: 1 },

  macrosCard: { backgroundColor: '#1C1C1C', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 16 },
  remainingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, borderTopWidth: 1, borderTopColor: '#2A2A2A', paddingTop: 10 },
  remainingLabel: { color: '#555', fontSize: 11, fontWeight: '600' },
  remainingVal: { color: '#CCC', fontSize: 11 },

  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: '#1C1C1C', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  statVal: { color: COLORS.primaryGreen, fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#555', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 2 },

  chartCard: { backgroundColor: '#1C1C1C', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 16 },

  logFoodBtn: { backgroundColor: COLORS.primaryGreen, borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  logFoodBtnText: { color: '#000', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },

  streaksRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  streakCard: { flex: 1, backgroundColor: '#1C1C1C', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  streakVal: { color: '#FFF', fontSize: 22, fontWeight: '800', marginTop: 4 },
  streakLabel: { color: '#555', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },

  recoveryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  recoveryDate: { color: '#444', fontSize: 11, width: 36 },
  recoveryTrack: { flex: 1, height: 4, backgroundColor: '#141414', borderRadius: 2, overflow: 'hidden' },
  recoveryFill: { height: 4, borderRadius: 2 },
  recoveryScore: { width: 36, fontSize: 12, fontWeight: '700', textAlign: 'right' },

  prRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  prName: { color: '#CCC', fontSize: 13, flex: 1 },
  prWeight: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  prReps: { color: '#555', fontSize: 12 },

  emptyNote: { color: '#444', fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  emptyCard: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  retryBtn: { marginTop: 16, backgroundColor: '#1A1A1A', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, borderWidth: 1, borderColor: '#2A2A2A' },

  // Motivation tab
  quoteCard: { backgroundColor: '#0A0F0A', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.strainGlow + '30', marginBottom: 16 },
  quoteIconRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  quoteLabelText: { color: COLORS.strainGlow, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  quoteText: { color: '#FFF', fontSize: 16, fontWeight: '600', lineHeight: 24, fontStyle: 'italic', marginBottom: 8 },
  quoteAuthor: { color: COLORS.textMuted, fontSize: 12 },

  badgeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badgeProgress: { height: 3, backgroundColor: '#1A1A1A', borderRadius: 2, overflow: 'hidden', marginBottom: 16 },
  badgeProgressFill: { height: '100%', backgroundColor: COLORS.strainGlow, borderRadius: 2 },

  badgesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  badgeCard: { width: '47%', backgroundColor: '#1C1C1C', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2A2A2A', gap: 4 },
  badgeCardLocked: { opacity: 0.6 },
  badgeIcon: { fontSize: 28, marginBottom: 4 },
  badgeLabel: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  badgeDesc: { color: '#555', fontSize: 11, lineHeight: 15 },
  earnedBadge: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 6, borderWidth: 1, alignSelf: 'flex-start', marginTop: 4 },
  earnedText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  prHighlight: { backgroundColor: '#1C1C1C', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 16 },
  prHighlightRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  prHighlightRank: { color: '#FFD700', fontSize: 14, fontWeight: '800', width: 24 },
  prHighlightName: { color: '#CCC', fontSize: 14, flex: 1 },
  prHighlightWeight: { color: '#FFF', fontSize: 16, fontWeight: '800' },
});