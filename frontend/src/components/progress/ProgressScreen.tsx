/**
 * ProgressScreen.tsx — complete rewrite
 *
 * What's new vs the old version:
 *   1. Weight chart — SVG sparkline with min/max labels & trend line
 *   2. Macro ring chart — visual macro breakdown (protein/carbs/fat)
 *   3. Food search — type a food name, results auto-appear from FatSecret
 *   4. One-tap log — select a food item → enter grams → done
 *   5. Streak & motivation banner — consecutive logging days
 *   6. Real today's macro targets vs consumed
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Dimensions, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { progressApi, describeApiError } from '../../utils/api';
import { COLORS } from '../../theme/colors';

const { width: SCREEN_W } = Dimensions.get('window');
const CHART_W = SCREEN_W - 64;
const CHART_H = 120;

// ─── Macro ring (SVG arc) ────────────────────────────────────────────────────
function MacroArc({ value, total, color, cx, cy, r, stroke }: any) {
  if (!total) return null;
  const pct = Math.min(value / total, 1);
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  return (
    <Svg.Circle
      cx={cx} cy={cy} r={r}
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeDasharray={`${dash} ${circ}`}
      strokeLinecap="round"
      transform={`rotate(-90, ${cx}, ${cy})`}
    />
  );
}

// ─── Weight sparkline ────────────────────────────────────────────────────────
function WeightChart({ data }: { data: { date: string; weight: number }[] }) {
  if (data.length < 2) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyText}>Log at least 2 weigh-ins to see your chart</Text>
      </View>
    );
  }
  const weights = data.map((d) => d.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const range = maxW - minW || 1;
  const pad = 16;
  const innerW = CHART_W - pad * 2;
  const innerH = CHART_H - pad * 2;

  const points = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * innerW;
    const y = pad + (1 - (d.weight - minW) / range) * innerH;
    return `${x},${y}`;
  }).join(' ');

  const lastX = pad + innerW;
  const lastY = pad + (1 - (weights[weights.length - 1] - minW) / range) * innerH;

  return (
    <View>
      <Svg width={CHART_W} height={CHART_H}>
        {/* Grid lines */}
        {[0, 0.5, 1].map((t) => (
          <Line
            key={t}
            x1={pad} y1={pad + t * innerH}
            x2={pad + innerW} y2={pad + t * innerH}
            stroke="#2A2A2A" strokeWidth={1}
          />
        ))}
        {/* Trend line */}
        <Polyline
          points={points}
          fill="none"
          stroke={COLORS.primaryGreen}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Last point dot */}
        <Circle cx={lastX} cy={lastY} r={4} fill={COLORS.primaryGreen} />
        {/* Labels */}
        <SvgText x={pad} y={pad - 4} fill="#555" fontSize={10}>{maxW} kg</SvgText>
        <SvgText x={pad} y={pad + innerH + 12} fill="#555" fontSize={10}>{minW} kg</SvgText>
      </Svg>
      <View style={styles.chartDateRow}>
        <Text style={styles.chartDate}>{data[0].date}</Text>
        <Text style={styles.chartDate}>{data[data.length - 1].date}</Text>
      </View>
    </View>
  );
}

// ─── Macro donut ─────────────────────────────────────────────────────────────
function MacroDonut({ protein, carbs, fat, calories, targetCal }: any) {
  const total = protein * 4 + carbs * 4 + fat * 9;
  const R = 48;
  const STROKE = 10;
  const C = 2 * Math.PI * R;

  const segments = [
    { value: protein * 4, color: '#4ADE80', label: 'Protein', grams: protein },
    { value: carbs * 4, color: '#60A5FA', label: 'Carbs', grams: carbs },
    { value: fat * 9, color: '#FBBF24', label: 'Fat', grams: fat },
  ];

  let cumulativePct = 0;
  const SIZE = (R + STROKE) * 2 + 8;

  return (
    <View style={styles.donutRow}>
      <Svg width={SIZE} height={SIZE}>
        {/* bg circle */}
        <Svg.Circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#2A2A2A" strokeWidth={STROKE} />
        {segments.map((seg, i) => {
          if (!total) return null;
          const pct = seg.value / total;
          const dash = C * pct;
          const offset = -C * cumulativePct;
          cumulativePct += pct;
          return (
            <Svg.Circle
              key={i}
              cx={SIZE / 2} cy={SIZE / 2} r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${C}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              transform={`rotate(-90, ${SIZE / 2}, ${SIZE / 2})`}
            />
          );
        })}
        <SvgText
          x={SIZE / 2} y={SIZE / 2 - 6}
          textAnchor="middle" fill="#FFF" fontSize={16} fontWeight="800"
        >
          {calories}
        </SvgText>
        <SvgText
          x={SIZE / 2} y={SIZE / 2 + 12}
          textAnchor="middle" fill="#555" fontSize={10}
        >
          kcal
        </SvgText>
      </Svg>

      <View style={styles.donutLegend}>
        {segments.map((seg) => (
          <View key={seg.label} style={styles.donutLegendRow}>
            <View style={[styles.donutDot, { backgroundColor: seg.color }]} />
            <Text style={styles.donutLegendLabel}>{seg.label}</Text>
            <Text style={styles.donutLegendVal}>{seg.grams}g</Text>
          </View>
        ))}
        {targetCal > 0 && (
          <View style={styles.donutLegendRow}>
            <View style={[styles.donutDot, { backgroundColor: '#444' }]} />
            <Text style={styles.donutLegendLabel}>Target</Text>
            <Text style={styles.donutLegendVal}>{targetCal} kcal</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Food search modal ────────────────────────────────────────────────────────
function FoodSearchModal({ visible, onClose, onLog }: {
  visible: boolean;
  onClose: () => void;
  onLog: (item: any, grams: number) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [grams, setGrams] = useState('100');
  const [logging, setLogging] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await progressApi.nutritionSearch(q);
      setResults(res.data?.foods || res.data || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 400);
    return () => clearTimeout(timer);
  }, [query, search]);

  const handleLog = async () => {
    if (!selected || !grams) return;
    setLogging(true);
    try {
      await onLog(selected, parseFloat(grams));
      setQuery('');
      setResults([]);
      setSelected(null);
      setGrams('100');
      onClose();
    } finally {
      setLogging(false);
    }
  };

  const reset = () => {
    setQuery(''); setResults([]); setSelected(null); setGrams('100');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Log Food</Text>
            <TouchableOpacity onPress={() => { reset(); onClose(); }}>
              <Ionicons name="close" size={22} color="#888" />
            </TouchableOpacity>
          </View>

          {!selected ? (
            <>
              <View style={styles.searchBar}>
                <Ionicons name="search-outline" size={16} color="#555" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search foods (e.g. chicken breast)"
                  placeholderTextColor="#555"
                  autoFocus
                />
                {searching && <ActivityIndicator size="small" color={COLORS.primaryGreen} />}
              </View>

              <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled">
                {results.map((item, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.resultItem}
                    onPress={() => setSelected(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultName} numberOfLines={1}>{item.food_name || item.name}</Text>
                      <Text style={styles.resultMeta}>
                        {item.calories ?? item.kcal_per_100g ?? '—'} kcal
                        {item.protein_g != null ? ` · P: ${item.protein_g}g` : ''}
                        {item.carbs_g != null ? ` · C: ${item.carbs_g}g` : ''}
                        {item.fat_g != null ? ` · F: ${item.fat_g}g` : ''}
                      </Text>
                    </View>
                    <Ionicons name="add-circle-outline" size={20} color={COLORS.primaryGreen} />
                  </TouchableOpacity>
                ))}
                {results.length === 0 && query.length >= 2 && !searching && (
                  <Text style={styles.noResults}>No results for "{query}"</Text>
                )}
              </ScrollView>
            </>
          ) : (
            <View style={styles.confirmPane}>
              <Text style={styles.confirmFoodName}>{selected.food_name || selected.name}</Text>
              <Text style={styles.confirmMacros}>
                per 100g: {selected.calories ?? '—'} kcal · P {selected.protein_g ?? '—'}g · C {selected.carbs_g ?? '—'}g · F {selected.fat_g ?? '—'}g
              </Text>

              <Text style={styles.label}>Amount (grams)</Text>
              <TextInput
                style={styles.gramsInput}
                value={grams}
                onChangeText={setGrams}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />

              <View style={styles.confirmBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelected(null)}>
                  <Text style={styles.cancelBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.logConfirmBtn} onPress={handleLog} disabled={logging}>
                  {logging
                    ? <ActivityIndicator color="#000" size="small" />
                    : <Text style={styles.logConfirmBtnText}>Log it</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function ProgressScreen() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [nutrition, setNutrition] = useState<any[]>([]);
  const [todayNutrition, setTodayNutrition] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [activeTab, setActiveTab] = useState<'body' | 'nutrition'>('body');
  const [showFoodSearch, setShowFoodSearch] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [mRes, nRes, todayRes] = await Promise.all([
        progressApi.getMetrics(30),
        progressApi.getNutritionHistory(14),
        progressApi.getTodayNutrition().catch(() => ({ data: null })),
      ]);
      setMetrics(mRes.data || []);
      setNutrition(nRes.data || []);
      setTodayNutrition(todayRes.data);
    } catch (err: any) {
      const { message } = describeApiError(err);
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const logWeight = async () => {
    const w = parseFloat(weightInput);
    if (!w || w < 30 || w > 300) {
      Alert.alert('Invalid weight', 'Enter a weight between 30 and 300 kg.');
      return;
    }
    try {
      await progressApi.logMetrics({ weight_kg: w });
      setWeightInput('');
      loadData();
    } catch {
      Alert.alert('Error', 'Could not save weight.');
    }
  };

  const handleFoodLog = async (item: any, grams: number) => {
    const ratio = grams / 100;
    const data = {
      meal_name: item.food_name || item.name,
      calories: Math.round((item.calories || 0) * ratio),
      protein_g: Math.round((item.protein_g || 0) * ratio),
      carbs_g: Math.round((item.carbs_g || 0) * ratio),
      fat_g: Math.round((item.fat_g || 0) * ratio),
    };
    try {
      // Try quick-log (food_id) first, fall back to manual log
      if (item.food_id) {
        await progressApi.quickLog(item.food_id, grams, item.food_name);
      } else {
        await progressApi.logNutrition(data);
      }
      Alert.alert('Logged ✓', `${item.food_name || item.name} (${grams}g) saved.`);
      loadData();
    } catch {
      Alert.alert('Error', 'Could not log meal.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primaryGreen} size="large" />
      </View>
    );
  }

  // Derived weight chart data
  const weightData = metrics
    .filter((m) => m.weight_kg)
    .map((m) => ({ date: (m.recorded_date || '').slice(5), weight: m.weight_kg }))
    .reverse();

  const latestWeight = weightData[weightData.length - 1]?.weight;
  const firstWeight = weightData[0]?.weight;
  const weightDelta = latestWeight && firstWeight ? +(latestWeight - firstWeight).toFixed(1) : null;

  // Today macro totals
  const todayConsumed = todayNutrition?.consumed;
  const todayTarget = todayNutrition?.targets;

  // Streak calculation
  const today = new Date().toISOString().split('T')[0];
  let streak = 0;
  const sortedNut = [...nutrition].sort((a, b) => (b.log_date || '').localeCompare(a.log_date || ''));
  for (let i = 0; i < sortedNut.length; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const expected = d.toISOString().split('T')[0];
    if (sortedNut[i]?.log_date === expected) streak++;
    else break;
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Ionicons name="stats-chart" size={18} color={COLORS.primaryGreen} />
          </View>
          <Text style={styles.title}>Progress</Text>
        </View>
        {streak >= 2 && (
          <View style={styles.streakBanner}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <Text style={styles.streakText}>{streak}-day logging streak — keep it up!</Text>
          </View>
        )}
      </View>

      {errorMsg && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={14} color="#FF5C5C" />
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      )}

      {/* Stat cards row */}
      <View style={styles.statsRow}>
        <View style={styles.heroStatCard}>
          <Ionicons name="trending-up-outline" size={18} color={COLORS.primaryGreen} />
          {latestWeight ? (
            <>
              <Text style={styles.heroStatValue}>{latestWeight}</Text>
              <Text style={styles.heroStatUnit}>kg current</Text>
              {weightDelta !== null && (
                <Text style={[styles.heroStatDelta, { color: weightDelta <= 0 ? COLORS.primaryGreen : '#FF9D5C' }]}>
                  {weightDelta > 0 ? '+' : ''}{weightDelta} kg
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.heroStatEmpty}>No weight logged yet</Text>
          )}
        </View>

        <View style={styles.stackedStats}>
          <View style={styles.smallStatCard}>
            <Ionicons name="restaurant-outline" size={14} color="#60A5FA" />
            <Text style={styles.smallStatValue}>{nutrition.length}</Text>
            <Text style={styles.smallStatLabel}>meals logged</Text>
          </View>
          <View style={styles.smallStatCard}>
            <Ionicons name="flame-outline" size={14} color="#FF9D5C" />
            <Text style={styles.smallStatValue}>
              {todayConsumed?.calories ?? '—'}
            </Text>
            <Text style={styles.smallStatLabel}>kcal today</Text>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['body', 'nutrition'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Ionicons
              name={tab === 'body' ? 'body-outline' : 'restaurant-outline'}
              size={14}
              color={activeTab === tab ? COLORS.primaryGreen : '#555'}
            />
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'body' ? 'BODY' : 'NUTRITION'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ─── BODY TAB ─── */}
      {activeTab === 'body' && (
        <>
          {/* Log weight */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>LOG BODYWEIGHT</Text>
            <View style={styles.row}>
              <TextInput
                style={styles.input}
                value={weightInput}
                onChangeText={setWeightInput}
                placeholder="e.g. 75.5 kg"
                placeholderTextColor="#555"
                keyboardType="decimal-pad"
              />
              <TouchableOpacity style={styles.logBtn} onPress={logWeight}>
                <Ionicons name="add-circle-outline" size={15} color="#000" />
                <Text style={styles.logBtnText}>LOG</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Weight chart */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>WEIGHT TREND (30 DAYS)</Text>
            <WeightChart data={weightData} />
          </View>

          {/* Weight history list */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>HISTORY</Text>
            {metrics.filter((m) => m.weight_kg).length === 0 ? (
              <Text style={styles.empty}>No weigh-ins yet.</Text>
            ) : (
              metrics.filter((m) => m.weight_kg).slice(0, 10).map((m, i) => (
                <View key={i} style={styles.metricRow}>
                  <Text style={styles.metricDate}>{m.recorded_date || '—'}</Text>
                  <Text style={styles.metricValue}>{m.weight_kg} kg</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}

      {/* ─── NUTRITION TAB ─── */}
      {activeTab === 'nutrition' && (
        <>
          {/* Today's macro donut */}
          {todayConsumed && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>TODAY'S MACROS</Text>
              <MacroDonut
                protein={todayConsumed.protein_g || 0}
                carbs={todayConsumed.carbs_g || 0}
                fat={todayConsumed.fat_g || 0}
                calories={todayConsumed.calories || 0}
                targetCal={todayTarget?.calories}
              />
              {todayTarget && (
                <View style={styles.macroTargetRow}>
                  {[
                    { label: 'Protein', consumed: todayConsumed.protein_g, target: todayTarget.protein_g, color: '#4ADE80' },
                    { label: 'Carbs', consumed: todayConsumed.carbs_g, target: todayTarget.carbs_g, color: '#60A5FA' },
                    { label: 'Fat', consumed: todayConsumed.fat_g, target: todayTarget.fat_g, color: '#FBBF24' },
                  ].map(({ label, consumed, target, color }) => (
                    <View key={label} style={styles.macroTargetItem}>
                      <Text style={styles.macroTargetLabel}>{label}</Text>
                      <View style={styles.macroBar}>
                        <View style={[
                          styles.macroBarFill,
                          { width: `${Math.min((consumed / (target || 1)) * 100, 100)}%` as any, backgroundColor: color },
                        ]} />
                      </View>
                      <Text style={styles.macroTargetNumbers}>
                        {consumed || 0} / {target || '?'}g
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Log food button */}
          <TouchableOpacity style={styles.addFoodBtn} onPress={() => setShowFoodSearch(true)}>
            <Ionicons name="search-outline" size={18} color="#000" />
            <Text style={styles.addFoodBtnText}>Search & Log Food</Text>
          </TouchableOpacity>

          {/* Recent nutrition logs */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>RECENT MEALS</Text>
            {nutrition.length === 0 ? (
              <View style={styles.emptyNutrition}>
                <Ionicons name="restaurant-outline" size={32} color="#2A2A2A" />
                <Text style={styles.empty}>No meals logged yet.</Text>
                <Text style={styles.emptyHint}>Tap "Search & Log Food" above to start.</Text>
              </View>
            ) : (
              nutrition.map((n, i) => (
                <View key={i} style={styles.metricRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mealName} numberOfLines={1}>
                      {n.meal_name || 'Meal'}
                    </Text>
                    <Text style={styles.metricDate}>{n.log_date}</Text>
                    <Text style={styles.metricSub}>
                      P: {n.protein_g}g · C: {n.carbs_g}g · F: {n.fat_g}g
                    </Text>
                  </View>
                  <Text style={styles.metricValue}>{n.calories} kcal</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}

      <View style={{ height: 32 }} />

      <FoodSearchModal
        visible={showFoodSearch}
        onClose={() => setShowFoodSearch(false)}
        onLog={handleFoodLog}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  center: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' },

  header: { padding: 24, paddingTop: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: '#1A2535', alignItems: 'center', justifyContent: 'center',
  },
  title: { color: '#FFF', fontSize: 28, fontWeight: '800' },

  streakBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1A2A1A', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 8, marginTop: 12, borderWidth: 1, borderColor: '#2A3A2A',
  },
  streakEmoji: { fontSize: 16 },
  streakText: { color: COLORS.primaryGreen, fontSize: 13, fontWeight: '600', flex: 1 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#2A1A1A', marginHorizontal: 16, borderRadius: 10,
    padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#3A2A2A',
  },
  errorBannerText: { color: '#FF5C5C', fontSize: 12, flex: 1 },

  statsRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 },
  heroStatCard: {
    flex: 1.1, backgroundColor: '#1E1E1E', borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: '#2A2A2A', minHeight: 130,
  },
  heroStatValue: { color: '#FFF', fontSize: 34, fontWeight: '800', marginTop: 8 },
  heroStatUnit: { color: '#888', fontSize: 13, fontWeight: '600', marginTop: 2 },
  heroStatDelta: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  heroStatEmpty: { color: '#555', fontSize: 13, marginTop: 10, lineHeight: 18 },
  stackedStats: { flex: 1, gap: 10 },
  smallStatCard: {
    flex: 1, backgroundColor: '#1E1E1E', borderRadius: 16,
    padding: 14, borderWidth: 1, borderColor: '#2A2A2A', justifyContent: 'center',
  },
  smallStatValue: { color: '#FFF', fontSize: 20, fontWeight: '800', marginTop: 6 },
  smallStatLabel: { color: '#888', fontSize: 11, fontWeight: '600', marginTop: 2 },

  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, gap: 8 },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#1A1A1A', alignItems: 'center',
    borderWidth: 1, borderColor: '#2A2A2A',
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  tabActive: { backgroundColor: '#1E3A5F', borderColor: '#2A4A7F' },
  tabText: { color: '#555', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  tabTextActive: { color: COLORS.primaryGreen },

  card: {
    backgroundColor: '#1E1E1E', borderRadius: 16,
    padding: 16, marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  cardLabel: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },

  row: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1, backgroundColor: '#252525', borderRadius: 12,
    padding: 14, color: '#FFF', fontSize: 16,
  },
  logBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 12,
    paddingHorizontal: 18, justifyContent: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  logBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },

  chartEmpty: { paddingVertical: 20, alignItems: 'center' },
  chartEmptyText: { color: '#555', fontSize: 13, textAlign: 'center' },
  chartDateRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  chartDate: { color: '#555', fontSize: 10 },

  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginVertical: 8 },
  donutLegend: { flex: 1, gap: 8 },
  donutLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  donutDot: { width: 8, height: 8, borderRadius: 4 },
  donutLegendLabel: { color: '#888', fontSize: 13, flex: 1 },
  donutLegendVal: { color: '#FFF', fontSize: 13, fontWeight: '700' },

  macroTargetRow: { gap: 10, marginTop: 16 },
  macroTargetItem: { gap: 4 },
  macroTargetLabel: { color: '#888', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  macroBar: {
    height: 6, backgroundColor: '#2A2A2A', borderRadius: 3, overflow: 'hidden',
  },
  macroBarFill: { height: 6, borderRadius: 3 },
  macroTargetNumbers: { color: '#555', fontSize: 11 },

  addFoodBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 14,
    marginHorizontal: 16, marginBottom: 12, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  addFoodBtnText: { color: '#000', fontWeight: '800', fontSize: 15 },

  metricRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A',
  },
  mealName: { color: '#FFF', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  metricDate: { color: '#888', fontSize: 12 },
  metricSub: { color: '#555', fontSize: 11, marginTop: 2 },
  metricValue: { color: COLORS.primaryGreen, fontSize: 15, fontWeight: '700', marginLeft: 8 },

  emptyNutrition: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  empty: { color: '#555', fontSize: 13, textAlign: 'center' },
  emptyHint: { color: '#444', fontSize: 12, textAlign: 'center' },

  label: { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginTop: 4 },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1A1A1A', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#252525', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 12, borderWidth: 1, borderColor: '#2A2A2A',
  },
  searchInput: { flex: 1, color: '#FFF', fontSize: 15 },
  resultsList: { maxHeight: 360 },
  resultItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2A2A2A', gap: 10,
  },
  resultName: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  resultMeta: { color: '#888', fontSize: 12, marginTop: 2 },
  noResults: { color: '#555', fontSize: 13, textAlign: 'center', paddingVertical: 20 },

  confirmPane: { gap: 12 },
  confirmFoodName: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  confirmMacros: { color: '#888', fontSize: 12 },
  gramsInput: {
    backgroundColor: '#252525', borderRadius: 12, padding: 14,
    color: '#FFF', fontSize: 22, fontWeight: '800', textAlign: 'center',
  },
  confirmBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#2A2A2A', alignItems: 'center',
  },
  cancelBtnText: { color: '#888', fontWeight: '700' },
  logConfirmBtn: {
    flex: 2, paddingVertical: 14, borderRadius: 12,
    backgroundColor: COLORS.primaryGreen, alignItems: 'center',
  },
  logConfirmBtnText: { color: '#000', fontWeight: '800', fontSize: 15 },
});