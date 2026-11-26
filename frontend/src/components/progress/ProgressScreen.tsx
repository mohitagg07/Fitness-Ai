// VYRN — Progress Screen
// Body, nutrition, recovery, review and analytics are independently browsable.
// Analytics chart selection is held by this screen so returning to Analytics
// restores the last chart while TanStack Query retains its data cache.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import Svg, { Line, Path, Circle, Text as SvgT } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { progressApi, nutritionApi, profileApi, describeApiError } from '../../utils/api';
import { COLORS, recoveryColor } from '../../theme/colors';
import { qk } from '../../lib/queryKeys';
import NutritionSearchModal from './NutritionSearchModal';
import WeightChart from './WeightChart';
import Logo from '../shared/Logo';
import WeeklyReviewScreen from './WeeklyReviewScreen';
import AnalyticsScreen, { type AnalyticsChartTab } from './AnalyticsScreen';
import MuscleRecoveryMap from './MuscleRecoveryMap';
import { SkeletonCard } from '../shared/LoadingOverlay';

type Tab = 'body' | 'nutrition' | 'recovery' | 'review' | 'analytics';

function ProteinAdherenceBar({ history }: { history: any[] }) {
  const days = history.slice(0, 7).reverse();
  if (days.length === 0) return <View style={P.empty}><Text style={P.emptyText}>Log nutrition to see adherence.</Text></View>;
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const met = days.filter((day) => (day.protein_g || 0) >= (day.protein_target_g || 999)).length;
  return (
    <View style={P.container}>
      <View style={P.headerRow}>
        <Text style={P.label}>PROTEIN ADHERENCE (7 DAYS)</Text>
        <Text style={[P.pct, { color: met >= 5 ? COLORS.recoveryHigh : met >= 3 ? COLORS.recoveryMed : COLORS.recoveryLow }]}>{met}/{days.length} days</Text>
      </View>
      <View style={P.bars}>
        {days.map((day, index) => {
          const target = day.protein_target_g || 160;
          const actual = day.protein_g || 0;
          const ratio = Math.min(1, actual / target);
          const metDay = actual >= target;
          return (
            <View key={day.recorded_date || index} style={P.barCol}>
              <View style={P.barTrack}>
                <View style={[P.barFill, {
                  height: Math.max(4, ratio * 100) + '%',
                  backgroundColor: metDay ? COLORS.recoveryHigh : ratio > 0.7 ? COLORS.recoveryMed : COLORS.border,
                }]} />
              </View>
              <Text style={P.dayLabel}>{labels[index % 7]}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const P = StyleSheet.create({
  container: { backgroundColor: COLORS.cardElevated, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  pct: { fontSize: 13, fontWeight: '700' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 60 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { flex: 1, width: '100%', backgroundColor: COLORS.border, borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  barFill: { width: '100%', borderRadius: 4 },
  dayLabel: { color: COLORS.textMuted, fontSize: 9, fontWeight: '600' },
  empty: { paddingVertical: 16, alignItems: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 13 },
});

function MacroRing({ pct, color, label, value }: { pct: number; color: string; label: string; value: string }) {
  const size = 72, stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const offset = circumference * (1 - safePct / 100);
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={COLORS.border} strokeWidth={stroke} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={stroke} fill="none"
            strokeDasharray={circumference + ' ' + circumference} strokeDashoffset={offset}
            strokeLinecap="round" rotation={-90} origin={size / 2 + ',' + size / 2} />
        </Svg>
      </View>
      <Text style={{ color: COLORS.text, fontSize: 12, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1 }}>{label}</Text>
    </View>
  );
}

function TodayMacros({ todayData }: { todayData: any }) {
  if (!todayData) return null;
  const { consumed = {}, targets = {}, remaining = {} } = todayData;
  const percent = (value: number, target: number) => target > 0 ? (value / target) * 100 : 0;
  return (
    <View style={styles.macrosCard}>
      <Text style={styles.sectionLabel}>TODAY'S NUTRITION</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
        <MacroRing pct={percent(consumed.calories || 0, targets.calories || 0)} color={COLORS.calories} label="CALORIES" value={String(Math.round(consumed.calories || 0))} />
        <MacroRing pct={percent(consumed.protein_g || 0, targets.protein_g || 0)} color={COLORS.recoveryHigh} label="PROTEIN" value={Math.round(consumed.protein_g || 0) + 'g'} />
        <MacroRing pct={percent(consumed.carbs_g || 0, targets.carbs_g || 0)} color={COLORS.strain} label="CARBS" value={Math.round(consumed.carbs_g || 0) + 'g'} />
        <MacroRing pct={percent(consumed.fat_g || 0, targets.fat_g || 0)} color={COLORS.recoveryMed} label="FAT" value={Math.round(consumed.fat_g || 0) + 'g'} />
      </View>
      <View style={styles.remainingRow}>
        <Text style={styles.remainingLabel}>Remaining:</Text>
        <Text style={styles.remainingVal}>{Math.round(remaining.calories || 0)} kcal · {Math.round(remaining.protein_g || 0)}g protein</Text>
      </View>
    </View>
  );
}

function CaloriesChart({ history, targetCal }: { history: any[]; targetCal: number }) {
  const [chartWidth, setChartWidth] = useState(320);
  const width = chartWidth, height = 80;
  const days = history.slice(0, 7).reverse();
  if (days.length < 2) return null;
  const pad = { left: 36, right: 8, top: 8, bottom: 20 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const values = days.map((day) => day.calories || 0);
  const max = Math.max(targetCal * 1.2, ...values, 1);
  const toX = (index: number) => pad.left + (index / (days.length - 1)) * plotWidth;
  const toY = (value: number) => pad.top + plotHeight - (value / max) * plotHeight;
  const linePath = values.map((value, index) => (index === 0 ? 'M' : 'L') + ' ' + toX(index).toFixed(1) + ' ' + toY(value).toFixed(1)).join(' ');
  const targetY = toY(targetCal);
  return (
    <View style={styles.chartCard} onLayout={(event) => {
      const nextWidth = Math.round(event.nativeEvent.layout.width - 28);
      if (nextWidth > 0 && nextWidth !== chartWidth) setChartWidth(nextWidth);
    }}>
      <Text style={styles.sectionLabel}>CALORIES VS TARGET (7 DAYS)</Text>
      <Svg width={width} height={height}>
        <Line x1={pad.left} y1={targetY} x2={width - pad.right} y2={targetY} stroke={COLORS.recoveryMed} strokeWidth={1} strokeDasharray="4 3" />
        <SvgT x={pad.left - 4} y={targetY + 4} fill={COLORS.recoveryMed} fontSize={8} textAnchor="end">{targetCal}</SvgT>
        <Path d={linePath} fill="none" stroke={COLORS.strain} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {values.map((value, index) => <Circle key={index} cx={toX(index)} cy={toY(value)} r={3} fill={value >= targetCal * 0.9 ? COLORS.recoveryHigh : COLORS.strain} stroke={COLORS.background} strokeWidth={1} />)}
      </Svg>
    </View>
  );
}

function RecoveryTrend({ metrics }: { metrics: any[] }) {
  const [chartWidth, setChartWidth] = useState(320);
  const width = chartWidth, height = 80;
  const data = metrics.filter((metric) => metric.recovery_score != null).slice(0, 14).reverse();
  if (data.length < 2) return <View style={styles.chartCard}><Text style={styles.sectionLabel}>RECOVERY TREND</Text><Text style={styles.emptyNote}>Log recovery scores to see your trend.</Text></View>;
  const pad = { left: 8, right: 8, top: 8, bottom: 8 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const values = data.map((metric) => metric.recovery_score || 0);
  const toX = (index: number) => pad.left + (index / (data.length - 1)) * plotWidth;
  const toY = (value: number) => pad.top + plotHeight - (value / 100) * plotHeight;
  const path = values.map((value, index) => (index === 0 ? 'M' : 'L') + toX(index).toFixed(1) + ',' + toY(value).toFixed(1)).join(' ');
  const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return (
    <View style={styles.chartCard} onLayout={(event) => {
      const nextWidth = Math.round(event.nativeEvent.layout.width - 28);
      if (nextWidth > 0 && nextWidth !== chartWidth) setChartWidth(nextWidth);
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={styles.sectionLabel}>RECOVERY TREND (14 DAYS)</Text>
        <Text style={{ color: recoveryColor(average), fontSize: 13, fontWeight: '700' }}>Avg {average}%</Text>
      </View>
      <Svg width={width} height={height}>
        <Path d={path} fill="none" stroke={COLORS.recoveryHigh} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {values.map((value, index) => <Circle key={index} cx={toX(index)} cy={toY(value)} r={3} fill={recoveryColor(value)} />)}
      </Svg>
    </View>
  );
}

function PRTable({ prs }: { prs: any[] }) {
  if (!prs.length) return <View style={styles.chartCard}><Text style={styles.emptyNote}>No PRs yet — log workouts to set records.</Text></View>;
  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionLabel}>PERSONAL RECORDS</Text>
      {prs.slice(0, 8).map((pr, index) => (
        <View key={pr.exercise_name + '-' + index} style={styles.prRow}>
          <Ionicons name="trophy" size={14} color={COLORS.gold} />
          <Text style={styles.prName}>{pr.exercise_name}</Text>
          <Text style={styles.prWeight}>{pr.weight_kg} kg</Text>
          <Text style={styles.prReps}>× {pr.reps}</Text>
        </View>
      ))}
    </View>
  );
}

function StreaksRow({ metrics, nutrition }: { metrics: any[]; nutrition: any[] }) {
  const logDays = metrics.filter((metric) => metric.weight_kg || metric.recovery_score).length;
  const proteinDays = nutrition.filter((day) => (day.protein_g || 0) >= (day.protein_target_g || 150)).length;
  return (
    <View style={styles.streaksRow}>
      <View style={styles.streakCard}>
        <Ionicons name="flame" size={22} color={COLORS.recoveryMed} />
        <Text style={styles.streakVal}>{logDays}</Text>
        <Text style={styles.streakLabel}>LOG DAYS</Text>
      </View>
      <View style={styles.streakCard}>
        <Ionicons name="nutrition" size={22} color={COLORS.recoveryHigh} />
        <Text style={styles.streakVal}>{proteinDays}</Text>
        <Text style={styles.streakLabel}>PROTEIN DAYS</Text>
      </View>
    </View>
  );
}

export default function ProgressScreen() {
  const responsive = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [metrics, setMetrics] = useState<any[]>([]);
  const [nutrition, setNutrition] = useState<any[]>([]);
  const [todayData, setTodayData] = useState<any>(null);
  const [prs, setPrs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('body');
  const [activeAnalyticsChart, setActiveAnalyticsChart] = useState<AnalyticsChartTab>('heatmap');
  const [logFoodVisible, setLogFoodVisible] = useState(false);
  const tabBarRef = useRef<ScrollView | null>(null);

  const loadData = useCallback(async () => {
    setErrorMsg(null);
    const results = await Promise.allSettled([
      progressApi.getMetrics(30),
      progressApi.getNutritionHistory(7),
      nutritionApi.getToday(),
      profileApi.getPRs(),
    ]);
    const failures: any[] = [];
    if (results[0].status === 'fulfilled') setMetrics(results[0].value.data || []);
    else failures.push(results[0].reason);
    if (results[1].status === 'fulfilled') setNutrition(results[1].value.data || []);
    else failures.push(results[1].reason);
    if (results[2].status === 'fulfilled') setTodayData(results[2].value.data || null);
    else failures.push(results[2].reason);
    if (results[3].status === 'fulfilled') setPrs(results[3].value.data || []);
    else failures.push(results[3].reason);

    if (failures.length === 4) setErrorMsg(describeApiError(failures[0]).message);
    else if (failures.length > 0) setErrorMsg('Some Progress data could not refresh. Your available data is still shown; pull down to retry.');
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await loadData();
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [loadData]);

  const hasFocusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!hasFocusedOnce.current) {
      hasFocusedOnce.current = true;
      return;
    }
    void loadData();
  }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        loadData(),
        queryClient.invalidateQueries({ queryKey: qk.analytics.all }),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const logWeight = async () => {
    const weight = parseFloat(weightInput);
    if (!Number.isFinite(weight) || weight < 30 || weight > 300) {
      Alert.alert('Invalid weight', 'Enter a weight between 30 and 300 kg.');
      return;
    }
    try {
      await progressApi.logMetrics({ weight_kg: weight });
      setWeightInput('');
      await loadData();
    } catch (error) {
      Alert.alert('Error', describeApiError(error).message || 'Could not save weight.');
    }
  };

  const logRecovery = async () => {
    const score = Number.parseInt(recoveryInput, 10);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      Alert.alert('Invalid score', 'Enter a whole number from 0 to 100.');
      return;
    }
    try {
      await progressApi.logMetrics({ recovery_score: score });
      setRecoveryInput('');
      await loadData();
    } catch (error) {
      Alert.alert('Error', describeApiError(error).message || 'Could not save recovery score.');
    }
  };

  const tabs: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'body', label: 'Body', icon: 'body-outline' },
    { key: 'nutrition', label: 'Nutrition', icon: 'nutrition-outline' },
    { key: 'recovery', label: 'Recovery', icon: 'pulse-outline' },
    { key: 'review', label: 'Review', icon: 'document-text-outline' },
    { key: 'analytics', label: 'Analytics', icon: 'analytics-outline' },
  ];

  const selectTab = (tab: Tab) => {
    setActiveTab(tab);
    const index = tabs.findIndex((item) => item.key === tab);
    const estimatedTabWidth = responsive.isTablet ? 128 : 112;
    tabBarRef.current?.scrollTo({ x: Math.max(0, index * estimatedTabWidth - 14), animated: true });
  };

  const targetCal = todayData?.targets?.calories || 2000;

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}><Logo size="sm" /><Text style={styles.headerSub}>Progress</Text></View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <SkeletonCard height={110} /><SkeletonCard height={80} /><SkeletonCard height={160} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NutritionSearchModal visible={logFoodVisible} onClose={() => setLogFoodVisible(false)} onLogged={loadData} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Logo size="sm" />
        <Text style={styles.headerSub}>Progress</Text>
      </View>

      <ScrollView
        ref={tabBarRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabBarScroll, { width: '100%', maxWidth: responsive.pageMaxWidth, alignSelf: 'center' }]}
        contentContainerStyle={[styles.tabBar, responsive.isTablet && styles.tabBarWide]}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="tablist"
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, responsive.isTablet && styles.tabWide, selected && styles.tabActive]}
              onPress={() => selectTab(tab.key)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label + ' progress category'}
              accessibilityState={{ selected }}
            >
              <Ionicons name={tab.icon} size={14} color={selected ? COLORS.primaryGreen : COLORS.textMuted} />
              <Text style={[styles.tabText, selected && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!!errorMsg && (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={15} color={COLORS.recoveryMed} />
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
          <TouchableOpacity onPress={onRefresh} accessibilityRole="button" accessibilityLabel="Retry Progress data refresh">
            <Text style={styles.errorRetry}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'review' ? (
        <WeeklyReviewScreen />
      ) : activeTab === 'analytics' ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, { width: '100%', maxWidth: responsive.pageMaxWidth, alignSelf: 'center', paddingBottom: responsive.gutter * 3 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primaryGreen} />}
        >
          <AnalyticsScreen embedded activeChart={activeAnalyticsChart} onActiveChartChange={setActiveAnalyticsChart} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { width: '100%', maxWidth: responsive.pageMaxWidth, alignSelf: 'center', paddingBottom: responsive.gutter * 3 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primaryGreen} />}
        >
          {activeTab === 'body' && (
            <>
              <View style={styles.logCard}>
                <Text style={styles.sectionLabel}>LOG WEIGHT</Text>
                <View style={styles.inputRow}>
                  <TextInput style={styles.numInput} placeholder="e.g. 78.5" placeholderTextColor={COLORS.textMuted} value={weightInput} onChangeText={setWeightInput} keyboardType="decimal-pad" returnKeyType="done" onSubmitEditing={logWeight} accessibilityLabel="Body weight in kilograms" />
                  <Text style={styles.unitLabel}>kg</Text>
                  <TouchableOpacity style={styles.logBtn} onPress={logWeight} accessibilityRole="button"><Text style={styles.logBtnText}>LOG</Text></TouchableOpacity>
                </View>
              </View>
              <WeightChart metrics={metrics} />
              {(() => {
                const latestWeight = metrics.find((metric) => metric.weight_kg)?.weight_kg;
                const weightMetrics = metrics.filter((metric) => metric.weight_kg);
                const delta = weightMetrics.length < 2 ? null : +(weightMetrics[0].weight_kg - weightMetrics[weightMetrics.length - 1].weight_kg).toFixed(1);
                if (!latestWeight) return null;
                return (
                  <View style={styles.statsGrid}>
                    <View style={styles.statCard}><Text style={styles.statVal}>{latestWeight} kg</Text><Text style={styles.statLabel}>LATEST LOG</Text></View>
                    {delta !== null && <View style={styles.statCard}><Text style={[styles.statVal, { color: delta === 0 ? COLORS.textSecondary : delta < 0 ? COLORS.recoveryHigh : COLORS.recoveryMed }]}>{delta > 0 ? '+' : ''}{delta} kg</Text><Text style={styles.statLabel}>CHANGE IN LOGS</Text></View>}
                    <View style={styles.statCard}><Text style={styles.statVal}>{weightMetrics.length}</Text><Text style={styles.statLabel}>WEIGH-INS</Text></View>
                  </View>
                );
              })()}
              <StreaksRow metrics={metrics} nutrition={nutrition} />
              <PRTable prs={prs} />
            </>
          )}

          {activeTab === 'nutrition' && (
            <>
              <TouchableOpacity style={styles.logFoodBtn} onPress={() => setLogFoodVisible(true)}>
                <Ionicons name="add-circle" size={18} color={COLORS.background} />
                <Text style={styles.logFoodBtnText}>LOG FOOD (FatSecret)</Text>
              </TouchableOpacity>
              <TodayMacros todayData={todayData} />
              <CaloriesChart history={nutrition} targetCal={targetCal} />
              <ProteinAdherenceBar history={nutrition} />
              {nutrition.length === 0 && (
                <View style={styles.emptyCard}>
                  <Ionicons name="nutrition-outline" size={36} color={COLORS.textDim} />
                  <Text style={styles.emptyNote}>Tap LOG FOOD to add your first meal via FatSecret</Text>
                </View>
              )}
            </>
          )}

          {activeTab === 'recovery' && (
            <>
              <MuscleRecoveryMap />
              <RecoveryTrend metrics={metrics} />
              <View style={styles.logCard}>
                <Text style={styles.sectionLabel}>LOG RECOVERY SCORE</Text>
                <Text style={styles.helperText}>How recovered do you feel today? (0 = exhausted · 100 = fully recovered)</Text>
                <View style={styles.inputRow}>
                  <TextInput style={styles.numInput} placeholder="e.g. 75" placeholderTextColor={COLORS.textMuted} value={recoveryInput} onChangeText={setRecoveryInput} keyboardType="numeric" returnKeyType="done" onSubmitEditing={logRecovery} accessibilityLabel="Self-reported recovery score from 0 to 100" />
                  <Text style={styles.unitLabel}>/ 100</Text>
                  <TouchableOpacity style={styles.logBtn} onPress={logRecovery} accessibilityRole="button"><Text style={styles.logBtnText}>LOG</Text></TouchableOpacity>
                </View>
              </View>
              <View style={styles.chartCard}>
                <Text style={styles.sectionLabel}>RECENT SELF-REPORTED SCORES</Text>
                {metrics.filter((metric) => metric.recovery_score != null).slice(0, 7).map((metric, index) => {
                  const score = metric.recovery_score;
                  const color = recoveryColor(score);
                  return (
                    <View key={metric.recorded_date || index} style={styles.recoveryRow}>
                      <Text style={styles.recoveryDate}>{(metric.recorded_date || '').slice(5) || '—'}</Text>
                      <View style={styles.recoveryTrack}><View style={[styles.recoveryFill, { width: Math.max(0, Math.min(100, score)) + '%', backgroundColor: color }]} /></View>
                      <Text style={[styles.recoveryScore, { color }]}>{score}%</Text>
                    </View>
                  );
                })}
                {metrics.filter((metric) => metric.recovery_score != null).length === 0 && <Text style={styles.emptyNote}>No recovery data yet. Log your first score above.</Text>}
              </View>
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 6 },
  headerSub: { color: COLORS.text, fontSize: 23, fontWeight: '700', letterSpacing: -0.4 },
  tabBarScroll: { borderBottomWidth: 1, borderBottomColor: COLORS.border, flexGrow: 0 },
  tabBar: { paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' },
  tabBarWide: { justifyContent: 'center' },
  tab: { flexGrow: 0, flexShrink: 0, minWidth: 104, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: COLORS.backgroundTop, borderWidth: 1, borderColor: COLORS.border },
  tabWide: { minWidth: 120 },
  tabActive: { backgroundColor: COLORS.card, borderColor: COLORS.primaryGreen + '70' },
  tabText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  tabTextActive: { color: COLORS.primaryGreen },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.cardElevated },
  errorBannerText: { color: COLORS.textSecondary, flex: 1, fontSize: 10, lineHeight: 15 },
  errorRetry: { color: COLORS.primaryGreen, fontSize: 11, fontWeight: '700' },
  scroll: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 36 },
  logCard: { backgroundColor: COLORS.cardElevated, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  sectionLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  helperText: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numInput: { flex: 1, backgroundColor: COLORS.inputBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.text, fontSize: 20, fontWeight: '700', borderWidth: 1, borderColor: COLORS.border },
  unitLabel: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  logBtn: { backgroundColor: COLORS.primaryGreen, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 13 },
  logBtnText: { color: COLORS.background, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  macrosCard: { backgroundColor: COLORS.cardElevated, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  remainingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 },
  remainingLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  remainingVal: { color: COLORS.textSecondary, fontSize: 11 },
  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: COLORS.cardElevated, borderRadius: 14, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  statVal: { color: COLORS.primaryGreen, fontSize: 18, fontWeight: '800' },
  statLabel: { color: COLORS.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  chartCard: { backgroundColor: COLORS.cardElevated, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  logFoodBtn: { backgroundColor: COLORS.primaryGreen, borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  logFoodBtnText: { color: COLORS.background, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  streaksRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  streakCard: { flex: 1, backgroundColor: COLORS.cardElevated, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  streakVal: { color: COLORS.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  streakLabel: { color: COLORS.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  recoveryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  recoveryDate: { color: COLORS.textMuted, fontSize: 11, width: 36 },
  recoveryTrack: { flex: 1, height: 4, backgroundColor: COLORS.inputBg, borderRadius: 2, overflow: 'hidden' },
  recoveryFill: { height: 4, borderRadius: 2 },
  recoveryScore: { width: 36, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  prName: { color: COLORS.textSecondary, fontSize: 13, flex: 1 },
  prWeight: { color: COLORS.text, fontSize: 14, fontWeight: '800' },
  prReps: { color: COLORS.textMuted, fontSize: 12 },
  emptyNote: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  emptyCard: { alignItems: 'center', paddingVertical: 32, gap: 12 },
});

