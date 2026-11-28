// VYRN — Progress Screen
// Body, nutrition, recovery, review and analytics are independently browsable.
// Analytics chart selection is held by this screen so returning to Analytics
// restores the last chart while TanStack Query retains its data cache.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import {
  View, Text, ScrollView, StyleSheet, Animated, LayoutAnimation, Platform, UIManager,
  TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import Svg, { Line, Path, Circle, Text as SvgT } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { progressApi, nutritionApi, profileApi, describeApiError } from '../../utils/api';
import { COLORS, recoveryColor, alpha } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import PressableScale from '../ui/PressableScale';
import Reveal from '../shared/Reveal';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { qk } from '../../lib/queryKeys';
import NutritionSearchModal from './NutritionSearchModal';
import WeightChart from './WeightChart';
import ProfileAvatar from '../shared/ProfileAvatar';
import AmbientGlow from '../shared/AmbientGlow';
import WeeklyReviewScreen from './WeeklyReviewScreen';
import AnalyticsScreen, { type AnalyticsChartTab, type AnalyticsRangeOption } from './AnalyticsScreen';
import MuscleRecoveryMap from './MuscleRecoveryMap';
import { SkeletonCard } from '../shared/LoadingOverlay';

type Tab = 'overview' | 'body' | 'nutrition' | 'recovery' | 'review' | 'analytics';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

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
                  height: (Math.max(4, ratio * 100) + '%') as any,
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
  container: { backgroundColor: COLORS.cardElevated, borderRadius: 23, padding: 18, borderWidth: 1, borderColor: COLORS.borderLight, marginBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label: { fontFamily: FONTS.bold,  color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  pct: { fontFamily: FONTS.bold,  fontSize: 13, fontWeight: '700' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 60 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: { flex: 1, width: '100%', backgroundColor: COLORS.border, borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  barFill: { width: '100%', borderRadius: 4 },
  dayLabel: { fontFamily: FONTS.semibold,  color: COLORS.textMuted, fontSize: 10, fontWeight: '600' },
  empty: { paddingVertical: 16, alignItems: 'center' },
  emptyText: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 13 },
});

function MacroRing({ pct, color, label, value }: { pct: number; color: string; label: string; value: string }) {
  const size = 72, stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const animatedPct = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    animatedPct.stopAnimation();
    if (reduceMotion) {
      animatedPct.setValue(safePct);
      return undefined;
    }
    const animation = Animated.timing(animatedPct, { toValue: safePct, duration: 720, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [animatedPct, safePct, reduceMotion]);
  const offset = animatedPct.interpolate({ inputRange: [0, 100], outputRange: [circumference, 0] });
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={COLORS.border} strokeWidth={stroke} fill="none" />
          <AnimatedCircle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={stroke} fill="none"
            strokeDasharray={circumference + ' ' + circumference} strokeDashoffset={offset as any}
            strokeLinecap="round" rotation={-90} origin={size / 2 + ',' + size / 2} />
        </Svg>
      </View>
      <Text style={{ color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 12, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>{label}</Text>
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
      <View style={styles.waterHeader}>
        <Text style={styles.remainingLabel}>WATER</Text>
        <Text style={styles.remainingVal}>{Math.round(consumed.water_ml || 0)} / {Math.round(targets.water_ml || 0)} ml</Text>
      </View>
      <View style={styles.waterTrack}>
        <View style={[styles.waterFill, { width: (Math.min(100, percent(consumed.water_ml || 0, targets.water_ml || 0)) + '%') as any }]} />
      </View>
    </View>
  );
}

function TodayMeals({ meals }: { meals: any[] }) {
  const entries = Array.isArray(meals) ? meals : [];
  return (
    <View style={styles.mealListCard}>
      <View style={styles.mealListHeader}>
        <Text style={styles.sectionLabel}>TODAY'S MEALS</Text>
        <Text style={styles.mealCount}>{entries.length} logged</Text>
      </View>
      {entries.length === 0 ? (
        <Text style={styles.emptyNote}>Your logged meals will appear here.</Text>
      ) : entries.slice(0, 8).map((meal, index) => (
        <View key={meal.id || index} style={styles.mealRow}>
          <View style={styles.mealCopy}>
            <Text style={styles.mealName} numberOfLines={1}>{meal.meal_name || 'Meal'}</Text>
            <Text style={styles.mealMeta}>{Math.round(meal.protein_g || 0)}g protein · {Math.round(meal.carbs_g || 0)}g carbs · {Math.round(meal.fat_g || 0)}g fat</Text>
          </View>
          <Text style={styles.mealCalories}>{Math.round(meal.calories || 0)} kcal</Text>
        </View>
      ))}
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
        <Text style={{ color: recoveryColor(average), fontFamily: FONTS.numericSemibold, fontSize: 12, fontWeight: '600' }}>Avg {average}%</Text>
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
  const logDays = new Set(metrics.filter((metric) => metric.weight_kg || metric.recovery_score).map((metric) => metric.recorded_date).filter(Boolean)).size;
  const proteinDays = nutrition.filter((day) => (day.protein_g || 0) >= (day.protein_target_g || 150)).length;
  return (
    <View style={styles.streaksRow}>
      <View style={styles.streakCard}>
        <Ionicons name="flame" size={22} color={COLORS.recoveryMed} />
        <Text style={styles.streakVal}>{logDays}</Text>
        <Text style={styles.streakLabel}>METRIC DAYS</Text>
      </View>
      <View style={styles.streakCard}>
        <Ionicons name="nutrition" size={22} color={COLORS.recoveryHigh} />
        <Text style={styles.streakVal}>{proteinDays}</Text>
        <Text style={styles.streakLabel}>PROTEIN DAYS</Text>
      </View>
    </View>
  );
}

function ProgressHubCard({
  icon,
  title,
  description,
  accent,
  onPress,
  wide = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  accent: string;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <PressableScale
      style={[styles.hubCard, wide && styles.hubCardWide]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title + '. ' + description}
    >
      <View style={[styles.hubIcon, { backgroundColor: alpha(accent, 0.12), borderColor: alpha(accent, 0.24) }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <View style={styles.hubCopy}>
        <Text style={styles.hubTitle}>{title}</Text>
        <Text style={styles.hubDescription}>{description}</Text>
      </View>
      <Ionicons name="arrow-forward" size={16} color={COLORS.textMuted} />
    </PressableScale>
  );
}

export default function ProgressScreen({ initialTab = 'overview' }: { initialTab?: Tab } = {}) {
  const isStandaloneNutrition = initialTab === 'nutrition';
  const responsive = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const routeParams = useLocalSearchParams<{ tab?: string }>();
  const queryClient = useQueryClient();
  const isNutritionRoute = routeParams.tab === 'nutrition';
  const [metrics, setMetrics] = useState<any[]>([]);
  const [nutrition, setNutrition] = useState<any[]>([]);
  const [todayData, setTodayData] = useState<any>(null);
  const [prs, setPrs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>(isNutritionRoute ? 'nutrition' : initialTab);
  const [activeAnalyticsChart, setActiveAnalyticsChart] = useState<AnalyticsChartTab>('heatmap');
  const [analyticsHeatmapRange, setAnalyticsHeatmapRange] = useState<AnalyticsRangeOption>(8);
  const [analyticsBalanceRange, setAnalyticsBalanceRange] = useState<AnalyticsRangeOption>(4);
  const [logFoodVisible, setLogFoodVisible] = useState(false);
  const tabBarRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (routeParams.tab === 'nutrition') setActiveTab('nutrition');
  }, [routeParams.tab]);

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
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActiveTab(tab);
    const index = tabs.findIndex((item) => item.key === tab);
    const estimatedTabWidth = responsive.isTablet ? 128 : 112;
    tabBarRef.current?.scrollTo({ x: Math.max(0, index * estimatedTabWidth - 14), animated: true });
  };

  const targetCal = todayData?.targets?.calories || 2000;
  const sectionContext: Record<Tab, { title: string; description: string }> = {
    overview: { title: 'Progress overview', description: 'Choose what you want to log or review.' },
    body: { title: 'Body & strength', description: 'Track weight changes, training consistency and personal records in one place.' },
    nutrition: { title: 'Food & daily targets', description: 'Log meals and compare calories, protein and macros with today’s targets.' },
    recovery: { title: 'Recovery & readiness', description: 'Record how recovered you feel and follow muscle recovery trends between sessions.' },
    review: { title: 'Your weekly review', description: 'Look back at the week, understand what worked and see what to focus on next.' },
    analytics: { title: 'Training analytics', description: 'Explore longer-term training patterns, strength balance and performance trends.' },
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}><ProfileAvatar size={38} onPress={() => router.push("/(tabs)/profile")} /><Text style={styles.headerSub}>{isStandaloneNutrition ? 'Nutrition' : 'Progress'}</Text></View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <SkeletonCard height={110} /><SkeletonCard height={80} /><SkeletonCard height={160} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AmbientGlow variant="workout" />
      <NutritionSearchModal visible={logFoodVisible} onClose={() => setLogFoodVisible(false)} onLogged={loadData} />
      <View style={[styles.header, { paddingTop: insets.top + 15 }]}>
        <View style={styles.headerTopRow}>
          <ProfileAvatar size={38} onPress={() => router.push("/(tabs)/profile")} />
          <Text style={styles.headerEyebrow}>{isStandaloneNutrition ? 'DAILY INTAKE' : 'YOUR PERFORMANCE'}</Text>
        </View>
        <Text style={styles.headerSub}>{isStandaloneNutrition ? 'Nutrition.' : 'Progress.'}</Text>
        <Text style={styles.headerDescription}>{isStandaloneNutrition ? 'Log meals and keep daily calories, protein, macros and hydration on target.' : 'Training, nutrition and recovery — tracked over time.'}</Text>
      </View>

      {!isStandaloneNutrition && activeTab !== 'overview' && (
        <View style={styles.progressNavRow}>
          <PressableScale
            style={styles.overviewBack}
            onPress={() => setActiveTab('overview')}
            accessibilityRole="button"
            accessibilityLabel="Back to progress overview"
          >
            <Ionicons name="grid-outline" size={15} color={COLORS.textSecondary} />
            <Text style={styles.overviewBackText}>Overview</Text>
          </PressableScale>
          <ScrollView
            ref={tabBarRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.tabBarScroll, { flex: 1 }]}
            contentContainerStyle={[styles.tabBar, responsive.isTablet && styles.tabBarWide]}
            keyboardShouldPersistTaps="handled"
            accessibilityRole="tablist"
          >
            {tabs.map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <PressableScale
                  key={tab.key}
                  style={[styles.tab, responsive.isTablet && styles.tabWide, selected && styles.tabActive]}
                  onPress={() => selectTab(tab.key)}
                  accessibilityRole="tab"
                  accessibilityLabel={tab.label + ' progress category'}
                  accessibilityState={{ selected }}
                >
                  <Ionicons name={tab.icon} size={14} color={selected ? COLORS.primaryGreen : COLORS.textMuted} />
                  <Text style={[styles.tabText, selected && styles.tabTextActive]}>{tab.label}</Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>
      )}

      {!!errorMsg && (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={15} color={COLORS.recoveryMed} />
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
          <PressableScale onPress={onRefresh} accessibilityRole="button" accessibilityLabel="Retry Progress data refresh">
            <Text style={styles.errorRetry}>Retry</Text>
          </PressableScale>
        </View>
      )}

      {!isStandaloneNutrition && activeTab !== 'overview' && (
        <View style={styles.sectionIntro}>
          <View style={styles.sectionIntroMark} />
          <View style={styles.sectionIntroCopy}>
            <Text style={styles.sectionIntroTitle}>{sectionContext[activeTab].title}</Text>
            <Text style={styles.sectionIntroText}>{sectionContext[activeTab].description}</Text>
          </View>
        </View>
      )}

      {activeTab === 'overview' ? (
        <Reveal key="overview" distance={7}>
          <ScrollView
            style={styles.hubScroll}
            contentContainerStyle={[styles.hubContent, { width: '100%', maxWidth: responsive.pageMaxWidth, alignSelf: 'center' }]}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primaryGreen} />}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hubIntro}>
              <Text style={styles.hubEyebrow}>TRACKING</Text>
              <Text style={styles.hubHeading}>Your progress</Text>
              <Text style={styles.hubSubheading}>Log a new entry or open a section to review your training data.</Text>
            </View>
            <ProgressHubCard
              icon="restaurant-outline"
              title="Log food"
              description="Search a meal or add a custom food entry."
              accent={COLORS.calories}
              onPress={() => setLogFoodVisible(true)}
              wide
            />
            <ProgressHubCard
              icon="body-outline"
              title="See progress"
              description="Weight history, strength, consistency and personal records."
              accent={COLORS.primaryGreen}
              onPress={() => selectTab('body')}
              wide
            />
            <View style={styles.hubGrid}>
              <ProgressHubCard
                icon="nutrition-outline"
                title="Nutrition"
                description="Daily calories, protein and macros."
                accent={COLORS.carbs}
                onPress={() => selectTab('nutrition')}
              />
              <ProgressHubCard
                icon="pulse-outline"
                title="Recovery"
                description="Readiness and muscle recovery."
                accent={COLORS.strain}
                onPress={() => selectTab('recovery')}
              />
              <ProgressHubCard
                icon="analytics-outline"
                title="Analytics"
                description="Training trends and performance."
                accent={COLORS.recoveryBlue}
                onPress={() => selectTab('analytics')}
              />
              <ProgressHubCard
                icon="calendar-outline"
                title="Weekly review"
                description="Sessions, consistency and weekly patterns."
                accent={COLORS.coachPurple}
                onPress={() => selectTab('review')}
              />
            </View>
          </ScrollView>
        </Reveal>
      ) : activeTab === 'review' ? (
        <Reveal key={activeTab} distance={7}><WeeklyReviewScreen /></Reveal>
      ) : activeTab === 'analytics' ? (
        <Reveal key={activeTab} distance={7}><ScrollView
          contentContainerStyle={[styles.scroll, { width: '100%', maxWidth: responsive.pageMaxWidth, alignSelf: 'center', paddingBottom: responsive.gutter * 3 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primaryGreen} />}
        >
          <AnalyticsScreen
            embedded
            activeChart={activeAnalyticsChart}
            onActiveChartChange={setActiveAnalyticsChart}
            heatmapRange={analyticsHeatmapRange}
            onHeatmapRangeChange={setAnalyticsHeatmapRange}
            balanceRange={analyticsBalanceRange}
            onBalanceRangeChange={setAnalyticsBalanceRange}
          />
        </ScrollView></Reveal>
      ) : (
        <Reveal key={activeTab} distance={7}><ScrollView
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
                  <PressableScale style={styles.logBtn} onPress={logWeight} accessibilityRole="button"><Text style={styles.logBtnText}>LOG</Text></PressableScale>
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
              <PressableScale style={styles.logFoodBtn} onPress={() => setLogFoodVisible(true)}>
                <Ionicons name="add-circle" size={18} color={COLORS.background} />
                <Text style={styles.logFoodBtnText}>ADD FOOD</Text>
              </PressableScale>
              <TodayMacros todayData={todayData} />
              <TodayMeals meals={todayData?.meals_today || []} />
              <CaloriesChart history={nutrition} targetCal={targetCal} />
              <ProteinAdherenceBar history={nutrition} />
              {nutrition.length === 0 && (
                <View style={styles.emptyCard}>
                  <Ionicons name="nutrition-outline" size={36} color={COLORS.textDim} />
                  <Text style={styles.emptyNote}>Search a food or create a custom entry to start tracking your nutrition.</Text>
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
                  <PressableScale style={styles.logBtn} onPress={logRecovery} accessibilityRole="button"><Text style={styles.logBtnText}>LOG</Text></PressableScale>
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
                      <View style={styles.recoveryTrack}><View style={[styles.recoveryFill, { width: (Math.max(0, Math.min(100, score)) + '%') as any, backgroundColor: color }]} /></View>
                      <Text style={[styles.recoveryScore, { color }]}>{score}%</Text>
                    </View>
                  );
                })}
                {metrics.filter((metric) => metric.recovery_score != null).length === 0 && <Text style={styles.emptyNote}>No recovery data yet. Log your first score above.</Text>}
              </View>
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView></Reveal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  progressNavRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 },
  overviewBack: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  overviewBackText: { color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 10 },
  hubScroll: { flex: 1 },
  hubContent: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 36, gap: 11 },
  hubIntro: { gap: 5, marginBottom: 7 },
  hubEyebrow: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 1.5 },
  hubHeading: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 25, lineHeight: 31, letterSpacing: -0.6 },
  hubSubheading: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 12, lineHeight: 18, maxWidth: 360 },
  hubGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 1 },
  hubCard: { width: '48.5%', minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, marginBottom: 0 },
  hubCardWide: { width: '100%', minHeight: 78, backgroundColor: COLORS.cardElevated },
  hubIcon: { width: 38, height: 38, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hubCopy: { flex: 1, minWidth: 0, gap: 4 },
  hubTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 12, lineHeight: 16 },
  hubDescription: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 14 },
  header: { paddingHorizontal: 20, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 7 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 7 },
  headerEyebrow: { fontFamily: FONTS.bold,  color: COLORS.primaryGreen, fontSize: 10, fontWeight: '800', letterSpacing: 1.75 },
  headerDescription: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 1 },
  headerSub: { fontFamily: FONTS.semibold,  color: COLORS.text, fontSize: 27, lineHeight: 32, fontWeight: '600', letterSpacing: -0.7 },
  tabBarScroll: { borderBottomWidth: 0, flexGrow: 0, backgroundColor: 'transparent' },
  tabBar: { paddingHorizontal: 18, paddingTop: 9, paddingBottom: 10, gap: 8, flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' },
  tabBarWide: { justifyContent: 'center' },
  tab: { flexGrow: 0, flexShrink: 0, minWidth: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'transparent', backgroundColor: 'transparent' },
  tabWide: { minWidth: 120 },
  tabActive: { backgroundColor: alpha(COLORS.primaryGreen, 0.12), borderColor: alpha(COLORS.primaryGreen, 0.24) },
  tabText: { fontFamily: FONTS.semibold,  color: COLORS.textMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.1 },
  tabTextActive: { color: COLORS.primaryGreen },
  sectionIntro: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 18, marginTop: 12, marginBottom: 2, padding: 13, borderRadius: 15, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  sectionIntroMark: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: COLORS.primaryGreen },
  sectionIntroCopy: { flex: 1, minWidth: 0, gap: 3 },
  sectionIntroTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13 },
  sectionIntroText: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 16 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.cardElevated },
  errorBannerText: { fontFamily: FONTS.regular,  color: COLORS.textSecondary, flex: 1, fontSize: 10, lineHeight: 15 },
  errorRetry: { fontFamily: FONTS.bold,  color: COLORS.primaryGreen, fontSize: 11, fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  logCard: { backgroundColor: COLORS.card, borderRadius: 25, padding: 19, borderWidth: 1, borderColor: COLORS.borderLight, marginBottom: 17 },
  sectionLabel: { fontFamily: FONTS.bold,  color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  helperText: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numInput: { fontFamily: FONTS.numericSemibold,  flex: 1, backgroundColor: COLORS.inputBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.text, fontSize: 20, fontWeight: '700', borderWidth: 1, borderColor: COLORS.border },
  unitLabel: { fontFamily: FONTS.semibold,  color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  logBtn: { backgroundColor: COLORS.primaryGreen, borderRadius: 16, paddingHorizontal: 19, paddingVertical: 14 },
  logBtnText: { fontFamily: FONTS.bold,  color: COLORS.background, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  macrosCard: { backgroundColor: COLORS.card, borderRadius: 25, padding: 19, borderWidth: 1, borderColor: COLORS.borderLight, marginBottom: 17 },
  remainingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 },
  remainingLabel: { fontFamily: FONTS.semibold,  color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  remainingVal: { fontFamily: FONTS.regular,  color: COLORS.textSecondary, fontSize: 11 },
  waterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 7 },
  waterTrack: { height: 7, backgroundColor: COLORS.border, borderRadius: 8, overflow: 'hidden' },
  waterFill: { height: '100%', backgroundColor: COLORS.strain, borderRadius: 8 },
  mealListCard: { backgroundColor: COLORS.card, borderRadius: 20, padding: 17, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  mealListHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  mealCount: { color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 11 },
  mealRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: COLORS.border },
  mealCopy: { flex: 1, minWidth: 0, gap: 3 },
  mealName: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13 },
  mealMeta: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10 },
  mealCalories: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 12 },
  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: COLORS.card, borderRadius: 21, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  statVal: { fontFamily: FONTS.numericSemibold,  color: COLORS.primaryGreen, fontSize: 18, fontWeight: '800' },
  statLabel: { fontFamily: FONTS.bold,  color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  chartCard: { backgroundColor: COLORS.card, borderRadius: 19, padding: 17, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  logFoodBtn: { backgroundColor: COLORS.primaryGreen, borderRadius: 15, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  logFoodBtnText: { fontFamily: FONTS.bold,  color: COLORS.background, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  streaksRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  streakCard: { flex: 1, backgroundColor: COLORS.card, borderRadius: 22, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  streakVal: { fontFamily: FONTS.numericSemibold,  color: COLORS.text, fontSize: 22, fontWeight: '800', marginTop: 4 },
  streakLabel: { fontFamily: FONTS.bold,  color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  recoveryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  recoveryDate: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 11, width: 36 },
  recoveryTrack: { flex: 1, height: 4, backgroundColor: COLORS.inputBg, borderRadius: 2, overflow: 'hidden' },
  recoveryFill: { height: 4, borderRadius: 2 },
  recoveryScore: { fontFamily: FONTS.numericSemibold,  width: 36, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  prName: { fontFamily: FONTS.regular,  color: COLORS.textSecondary, fontSize: 13, flex: 1 },
  prWeight: { fontFamily: FONTS.numericSemibold,  color: COLORS.text, fontSize: 14, fontWeight: '800' },
  prReps: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 12 },
  emptyNote: { fontFamily: FONTS.regular,  color: COLORS.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  emptyCard: { alignItems: 'center', paddingVertical: 32, gap: 12 },
});

