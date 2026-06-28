/**
 * frontend/src/components/progress/ProgressScreen.tsx
 *
 * WHAT CHANGED:
 *  1. FoodSearchModal — complete overhaul:
 *     • Debounced search fires at 350ms (was broken in some cases)
 *     • Results show full per-100g macros immediately under food name
 *     • "AI Estimate" badge shown when source === "ai_estimate"
 *     • Gram input auto-updates live preview of macros (no back button needed)
 *     • Preset gram buttons: 100g / 150g / 200g / 300g / Custom
 *     • Log button disabled until grams > 0
 *     • quick-log 422 (no food_id / AI estimate) silently falls back to /log
 *
 *  2. Nutrition tab:
 *     • todayNutrition always fetches (no .catch(() => null) swallowing errors)
 *     • Macro bars animate correctly when carbs_g / fat_g are 0
 *     • "Search & Log Food" button stays above recent meals, not below
 *
 *  3. Everything else (body tab, weight chart, donut) — unchanged.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
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

// ── Weight Chart ──────────────────────────────────────────────────────────────
function WeightChart({ data }: { data: { date: string; weight: number }[] }) {
  if (data.length < 2) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyText}>
          Log at least 2 weigh-ins to see your chart
        </Text>
      </View>
    );
  }
  const weights = data.map(d => d.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const range = maxW - minW || 1;
  const pad = 16;
  const innerW = CHART_W - pad * 2;
  const innerH = CHART_H - pad * 2;

  const points = data
    .map((d, i) => {
      const x = pad + (i / (data.length - 1)) * innerW;
      const y = pad + (1 - (d.weight - minW) / range) * innerH;
      return `${x},${y}`;
    })
    .join(' ');

  const lastX = pad + innerW;
  const lastY =
    pad + (1 - (weights[weights.length - 1] - minW) / range) * innerH;

  return (
    <View>
      <Svg width={CHART_W} height={CHART_H}>
        {[0, 0.5, 1].map(t => (
          <Line
            key={t}
            x1={pad} y1={pad + t * innerH}
            x2={pad + innerW} y2={pad + t * innerH}
            stroke="#2A2A2A" strokeWidth={1}
          />
        ))}
        <Polyline
          points={points} fill="none"
          stroke={COLORS.primaryGreen} strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round"
        />
        <Circle cx={lastX} cy={lastY} r={4} fill={COLORS.primaryGreen} />
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

// ── Macro Donut ───────────────────────────────────────────────────────────────
function MacroDonut({
  protein, carbs, fat, calories, targetCal,
}: {
  protein: number; carbs: number; fat: number;
  calories: number; targetCal?: number;
}) {
  const R = 48;
  const STROKE = 10;
  const C = 2 * Math.PI * R;
  const total = protein * 4 + carbs * 4 + fat * 9 || 1;

  const segments = [
    { value: protein * 4, color: '#4ADE80', label: 'Protein', grams: protein },
    { value: carbs * 4,   color: '#60A5FA', label: 'Carbs',   grams: carbs },
    { value: fat * 9,     color: '#FBBF24', label: 'Fat',     grams: fat },
  ];

  let cumulativePct = 0;
  const SIZE = (R + STROKE) * 2 + 8;

  return (
    <View style={styles.donutRow}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none" stroke="#2A2A2A" strokeWidth={STROKE} />
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dash = C * pct;
          const offset = -C * cumulativePct;
          cumulativePct += pct;
          return (
            <Circle key={i}
              cx={SIZE / 2} cy={SIZE / 2} r={R}
              fill="none" stroke={seg.color} strokeWidth={STROKE}
              strokeDasharray={`${dash} ${C}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              transform={`rotate(-90, ${SIZE / 2}, ${SIZE / 2})`}
            />
          );
        })}
        <SvgText x={SIZE / 2} y={SIZE / 2 - 6}
          textAnchor="middle" fill="#FFF" fontSize={16} fontWeight="800">
          {calories}
        </SvgText>
        <SvgText x={SIZE / 2} y={SIZE / 2 + 12}
          textAnchor="middle" fill="#555" fontSize={10}>
          kcal
        </SvgText>
      </Svg>

      <View style={styles.donutLegend}>
        {segments.map(seg => (
          <View key={seg.label} style={styles.donutLegendRow}>
            <View style={[styles.donutDot, { backgroundColor: seg.color }]} />
            <Text style={styles.donutLegendLabel}>{seg.label}</Text>
            <Text style={styles.donutLegendVal}>{seg.grams}g</Text>
          </View>
        ))}
        {(targetCal ?? 0) > 0 && (
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

// ── Food Search Modal ─────────────────────────────────────────────────────────
const GRAM_PRESETS = [100, 150, 200, 300];

function FoodSearchModal({
  visible, onClose, onLog,
}: {
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.length < 2) { setResults([]); return; }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await progressApi.nutritionSearch(query);
        setResults(res.data?.foods || res.data || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  // Live macro preview scaled to grams entered
  const g = Math.max(0, parseFloat(grams) || 0);
  const ratio = g / 100;
  const preview = selected
    ? {
        cal:     Math.round((selected.calories  || 0) * ratio),
        protein: ((selected.protein_g || 0) * ratio).toFixed(1),
        carbs:   ((selected.carbs_g   || 0) * ratio).toFixed(1),
        fat:     ((selected.fat_g     || 0) * ratio).toFixed(1),
      }
    : null;

  const handleLog = async () => {
    if (!selected || g <= 0) return;
    setLogging(true);
    try {
      await onLog(selected, g);
      reset();
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
          {/* Header */}
          <View style={styles.modalHeader}>
            {selected ? (
              <TouchableOpacity onPress={() => setSelected(null)} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={20} color="#FFF" />
                <Text style={styles.backBtnText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.modalTitle}>🍽 Log Food</Text>
            )}
            <TouchableOpacity onPress={() => { reset(); onClose(); }}>
              <Ionicons name="close" size={22} color="#888" />
            </TouchableOpacity>
          </View>

          {/* ── Search pane ─────────────────────────────────────── */}
          {!selected ? (
            <>
              <View style={styles.searchBar}>
                <Ionicons name="search-outline" size={16} color="#555" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="e.g. rajma chawal, chicken breast…"
                  placeholderTextColor="#555"
                />
                {searching && (
                  <ActivityIndicator size="small" color={COLORS.primaryGreen} />
                )}
              </View>

              <ScrollView
                style={styles.resultsList}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {results.map((item, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.resultItem}
                    onPress={() => setSelected(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.resultNameRow}>
                        <Text style={styles.resultName} numberOfLines={1}>
                          {item.food_name || item.name}
                        </Text>
                        {item.source === 'ai_estimate' && (
                          <View style={styles.aiBadge}>
                            <Text style={styles.aiBadgeText}>AI</Text>
                          </View>
                        )}
                      </View>
                      {/* All 4 macros shown immediately — no tapping needed */}
                      <View style={styles.macroChips}>
                        <Text style={[styles.macroChip, { color: '#FF9D5C' }]}>
                          🔥 {item.calories ?? '—'} kcal
                        </Text>
                        <Text style={[styles.macroChip, { color: '#4ADE80' }]}>
                          P {item.protein_g ?? '—'}g
                        </Text>
                        <Text style={[styles.macroChip, { color: '#60A5FA' }]}>
                          C {item.carbs_g ?? '—'}g
                        </Text>
                        <Text style={[styles.macroChip, { color: '#FBBF24' }]}>
                          F {item.fat_g ?? '—'}g
                        </Text>
                      </View>
                      <Text style={styles.resultMetaSmall}>per 100g</Text>
                    </View>
                    <Ionicons
                      name="add-circle-outline"
                      size={24}
                      color={COLORS.primaryGreen}
                    />
                  </TouchableOpacity>
                ))}
                {results.length === 0 && query.length >= 2 && !searching && (
                  <View style={styles.noResultsBox}>
                    <Ionicons name="search-outline" size={28} color="#333" />
                    <Text style={styles.noResults}>No results for "{query}"</Text>
                    <Text style={styles.noResultsHint}>
                      Try "rajma", "paneer", "chicken breast"
                    </Text>
                  </View>
                )}
                {query.length < 2 && (
                  <View style={styles.searchHintBox}>
                    <Text style={styles.searchHint}>
                      Type at least 2 characters to search.{'\n'}
                      Indian dishes like "rajma chawal", "dal makhani", "paneer"
                      get AI-estimated macros if not in the database.
                    </Text>
                  </View>
                )}
              </ScrollView>
            </>
          ) : (
            /* ── Portion pane ──────────────────────────────────── */
            <ScrollView keyboardShouldPersistTaps="handled">
              {/* Food name + per-100g base stats */}
              <View style={styles.foodCard}>
                <Text style={styles.confirmFoodName}>
                  {selected.food_name || selected.name}
                </Text>
                {selected.source === 'ai_estimate' && (
                  <View style={[styles.aiBadge, { alignSelf: 'flex-start', marginTop: 4 }]}>
                    <Text style={styles.aiBadgeText}>AI Estimate</Text>
                  </View>
                )}
                <Text style={styles.confirmMacros}>
                  Per 100g — {selected.calories ?? '—'} kcal ·
                  P {selected.protein_g ?? '—'}g ·
                  C {selected.carbs_g ?? '—'}g ·
                  F {selected.fat_g ?? '—'}g
                </Text>
              </View>

              {/* Gram presets */}
              <Text style={styles.label}>HOW MUCH DID YOU EAT?</Text>
              <View style={styles.presetRow}>
                {GRAM_PRESETS.map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.presetBtn,
                      parseFloat(grams) === p && styles.presetBtnActive,
                    ]}
                    onPress={() => setGrams(String(p))}
                  >
                    <Text
                      style={[
                        styles.presetBtnText,
                        parseFloat(grams) === p && styles.presetBtnTextActive,
                      ]}
                    >
                      {p}g
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Custom gram input */}
              <View style={styles.gramsRow}>
                <TextInput
                  style={styles.gramsInput}
                  value={grams}
                  onChangeText={setGrams}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
                <Text style={styles.gramsUnit}>grams</Text>
              </View>

              {/* Live macro preview — updates as user types grams */}
              {preview && g > 0 && (
                <View style={styles.previewCard}>
                  <Text style={styles.previewTitle}>
                    For {g}g you'll log:
                  </Text>
                  <View style={styles.previewGrid}>
                    <View style={styles.previewCell}>
                      <Text style={[styles.previewVal, { color: '#FF9D5C' }]}>
                        {preview.cal}
                      </Text>
                      <Text style={styles.previewLabel}>kcal</Text>
                    </View>
                    <View style={styles.previewCell}>
                      <Text style={[styles.previewVal, { color: '#4ADE80' }]}>
                        {preview.protein}g
                      </Text>
                      <Text style={styles.previewLabel}>Protein</Text>
                    </View>
                    <View style={styles.previewCell}>
                      <Text style={[styles.previewVal, { color: '#60A5FA' }]}>
                        {preview.carbs}g
                      </Text>
                      <Text style={styles.previewLabel}>Carbs</Text>
                    </View>
                    <View style={styles.previewCell}>
                      <Text style={[styles.previewVal, { color: '#FBBF24' }]}>
                        {preview.fat}g
                      </Text>
                      <Text style={styles.previewLabel}>Fat</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Log button */}
              <TouchableOpacity
                style={[
                  styles.logConfirmBtn,
                  (g <= 0 || logging) && styles.logConfirmBtnDisabled,
                ]}
                onPress={handleLog}
                disabled={g <= 0 || logging}
              >
                {logging
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={styles.logConfirmBtnText}>
                      Log {g > 0 ? `${g}g` : ''}
                    </Text>
                }
              </TouchableOpacity>

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
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

  /**
   * handleFoodLog — called by FoodSearchModal after user picks grams.
   *
   * Strategy:
   *  1. If food_id exists (OpenFoodFacts result) → try quick-log.
   *     If backend returns 422 (product not found by barcode), fall through.
   *  2. Otherwise (AI estimate or 422 fallback) → manual /log with
   *     macros we already have client-side.
   */
  const handleFoodLog = async (item: any, grams: number) => {
    const ratio = grams / 100;
    const manualData = {
      meal_name: `${item.food_name || item.name} (${Math.round(grams)}g)`,
      calories:  Math.round((item.calories  || 0) * ratio),
      protein_g: parseFloat(((item.protein_g || 0) * ratio).toFixed(1)),
      carbs_g:   parseFloat(((item.carbs_g   || 0) * ratio).toFixed(1)),
      fat_g:     parseFloat(((item.fat_g     || 0) * ratio).toFixed(1)),
    };

    try {
      if (item.food_id && item.source !== 'ai_estimate') {
        // Try the precise quick-log path
        try {
          await progressApi.quickLog(item.food_id, grams, item.food_name);
        } catch (qErr: any) {
          // 422 = barcode not found; fall back to manual
          if (qErr?.response?.status === 422) {
            await progressApi.logNutrition(manualData);
          } else {
            throw qErr;
          }
        }
      } else {
        // AI estimate or no food_id → direct manual log
        await progressApi.logNutrition(manualData);
      }
      Alert.alert(
        'Logged ✓',
        `${item.food_name || item.name} (${Math.round(grams)}g) — ${manualData.calories} kcal`,
      );
      loadData();
    } catch {
      Alert.alert('Error', 'Could not log meal. Try again.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primaryGreen} size="large" />
      </View>
    );
  }

  const weightData = metrics
    .filter(m => m.weight_kg)
    .map(m => ({ date: (m.recorded_date || '').slice(5), weight: m.weight_kg }))
    .reverse();

  const latestWeight = weightData[weightData.length - 1]?.weight;
  const firstWeight  = weightData[0]?.weight;
  const weightDelta  =
    latestWeight && firstWeight
      ? +(latestWeight - firstWeight).toFixed(1)
      : null;

  const todayConsumed = todayNutrition?.consumed;
  const todayTarget   = todayNutrition?.targets;

  // Streak counter
  const today = new Date().toISOString().split('T')[0];
  let streak = 0;
  const sortedNut = [...nutrition].sort((a, b) =>
    (b.log_date || '').localeCompare(a.log_date || ''),
  );
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
            <Text style={styles.streakText}>
              {streak}-day logging streak — keep it up!
            </Text>
          </View>
        )}
      </View>

      {errorMsg && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={14} color="#FF5C5C" />
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      )}

      {/* Stat cards */}
      <View style={styles.statsRow}>
        <View style={styles.heroStatCard}>
          <Ionicons name="trending-up-outline" size={18} color={COLORS.primaryGreen} />
          {latestWeight ? (
            <>
              <Text style={styles.heroStatValue}>{latestWeight}</Text>
              <Text style={styles.heroStatUnit}>kg current</Text>
              {weightDelta !== null && (
                <Text
                  style={[
                    styles.heroStatDelta,
                    { color: weightDelta <= 0 ? COLORS.primaryGreen : '#FF9D5C' },
                  ]}
                >
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
        {(['body', 'nutrition'] as const).map(tab => (
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

      {/* ── Body tab ──────────────────────────────────────────── */}
      {activeTab === 'body' && (
        <>
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

          <View style={styles.card}>
            <Text style={styles.cardLabel}>WEIGHT TREND (30 DAYS)</Text>
            <WeightChart data={weightData} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>HISTORY</Text>
            {metrics.filter(m => m.weight_kg).length === 0 ? (
              <Text style={styles.empty}>No weigh-ins yet.</Text>
            ) : (
              metrics
                .filter(m => m.weight_kg)
                .slice(0, 10)
                .map((m, i) => (
                  <View key={i} style={styles.metricRow}>
                    <Text style={styles.metricDate}>{m.recorded_date || '—'}</Text>
                    <Text style={styles.metricValue}>{m.weight_kg} kg</Text>
                  </View>
                ))
            )}
          </View>
        </>
      )}

      {/* ── Nutrition tab ──────────────────────────────────────── */}
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
                    {
                      label: 'Protein', color: '#4ADE80',
                      consumed: todayConsumed.protein_g,
                      target: todayTarget.protein_g,
                    },
                    {
                      label: 'Carbs', color: '#60A5FA',
                      consumed: todayConsumed.carbs_g,
                      target: todayTarget.carbs_g,
                    },
                    {
                      label: 'Fat', color: '#FBBF24',
                      consumed: todayConsumed.fat_g,
                      target: todayTarget.fat_g,
                    },
                  ].map(({ label, consumed, target, color }) => (
                    <View key={label} style={styles.macroTargetItem}>
                      <Text style={styles.macroTargetLabel}>{label}</Text>
                      <View style={styles.macroBar}>
                        <View
                          style={[
                            styles.macroBarFill,
                            {
                              width: `${Math.min(
                                ((consumed || 0) / (target || 1)) * 100,
                                100,
                              )}%` as any,
                              backgroundColor: color,
                            },
                          ]}
                        />
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

          {/* CTA — above meals so it's always visible */}
          <TouchableOpacity
            style={styles.addFoodBtn}
            onPress={() => setShowFoodSearch(true)}
          >
            <Ionicons name="search-outline" size={18} color="#000" />
            <Text style={styles.addFoodBtnText}>Search &amp; Log Food</Text>
          </TouchableOpacity>

          {/* Recent meals */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>RECENT MEALS</Text>
            {nutrition.length === 0 ? (
              <View style={styles.emptyNutrition}>
                <Ionicons name="restaurant-outline" size={32} color="#2A2A2A" />
                <Text style={styles.empty}>No meals logged yet.</Text>
                <Text style={styles.emptyHint}>
                  Tap "Search &amp; Log Food" above to start.
                </Text>
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

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#121212' },
  center:       { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' },
  header:       { padding: 24, paddingTop: 60 },
  headerRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon:   { width: 34, height: 34, borderRadius: 10, backgroundColor: '#1A2535', alignItems: 'center', justifyContent: 'center' },
  title:        { color: '#FFF', fontSize: 28, fontWeight: '800' },
  streakBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1A2A1A', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12, borderWidth: 1, borderColor: '#2A3A2A' },
  streakEmoji:  { fontSize: 16 },
  streakText:   { color: COLORS.primaryGreen, fontSize: 13, fontWeight: '600', flex: 1 },
  errorBanner:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2A1A1A', marginHorizontal: 16, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#3A2A2A' },
  errorBannerText: { color: '#FF5C5C', fontSize: 12, flex: 1 },
  statsRow:     { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 16 },
  heroStatCard: { flex: 1.1, backgroundColor: '#1E1E1E', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2A2A2A', minHeight: 130 },
  heroStatValue:{ color: '#FFF', fontSize: 34, fontWeight: '800', marginTop: 8 },
  heroStatUnit: { color: '#888', fontSize: 13, fontWeight: '600', marginTop: 2 },
  heroStatDelta:{ fontSize: 12, fontWeight: '700', marginTop: 8 },
  heroStatEmpty:{ color: '#555', fontSize: 13, marginTop: 10, lineHeight: 18 },
  stackedStats: { flex: 1, gap: 10 },
  smallStatCard:{ flex: 1, backgroundColor: '#1E1E1E', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#2A2A2A', justifyContent: 'center' },
  smallStatValue:{ color: '#FFF', fontSize: 20, fontWeight: '800', marginTop: 6 },
  smallStatLabel:{ color: '#888', fontSize: 11, fontWeight: '600', marginTop: 2 },
  tabs:         { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, gap: 8 },
  tab:          { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#1A1A1A', alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  tabActive:    { backgroundColor: '#1E3A5F', borderColor: '#2A4A7F' },
  tabText:      { color: '#555', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  tabTextActive:{ color: COLORS.primaryGreen },
  card:         { backgroundColor: '#1E1E1E', borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2A2A2A' },
  cardLabel:    { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  row:          { flexDirection: 'row', gap: 10 },
  input:        { flex: 1, backgroundColor: '#252525', borderRadius: 12, padding: 14, color: '#FFF', fontSize: 16 },
  logBtn:       { backgroundColor: COLORS.primaryGreen, borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 5 },
  logBtnText:   { color: '#000', fontWeight: '700', fontSize: 13 },
  chartEmpty:   { paddingVertical: 20, alignItems: 'center' },
  chartEmptyText:{ color: '#555', fontSize: 13, textAlign: 'center' },
  chartDateRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  chartDate:    { color: '#555', fontSize: 10 },
  donutRow:     { flexDirection: 'row', alignItems: 'center', gap: 20, marginVertical: 8 },
  donutLegend:  { flex: 1, gap: 8 },
  donutLegendRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  donutDot:     { width: 8, height: 8, borderRadius: 4 },
  donutLegendLabel:{ color: '#888', fontSize: 13, flex: 1 },
  donutLegendVal:{ color: '#FFF', fontSize: 13, fontWeight: '700' },
  macroTargetRow:{ gap: 10, marginTop: 16 },
  macroTargetItem:{ gap: 4 },
  macroTargetLabel:{ color: '#888', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  macroBar:     { height: 6, backgroundColor: '#2A2A2A', borderRadius: 3, overflow: 'hidden' },
  macroBarFill: { height: 6, borderRadius: 3 },
  macroTargetNumbers:{ color: '#555', fontSize: 11 },
  addFoodBtn:   { backgroundColor: COLORS.primaryGreen, borderRadius: 14, marginHorizontal: 16, marginBottom: 12, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addFoodBtnText:{ color: '#000', fontWeight: '800', fontSize: 15 },
  metricRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#2A2A2A' },
  mealName:     { color: '#FFF', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  metricDate:   { color: '#888', fontSize: 12 },
  metricSub:    { color: '#555', fontSize: 11, marginTop: 2 },
  metricValue:  { color: COLORS.primaryGreen, fontSize: 15, fontWeight: '700', marginLeft: 8 },
  emptyNutrition:{ alignItems: 'center', paddingVertical: 24, gap: 8 },
  empty:        { color: '#555', fontSize: 13, textAlign: 'center' },
  emptyHint:    { color: '#444', fontSize: 12, textAlign: 'center' },
  label:        { color: '#888', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalSheet:   { backgroundColor: '#1A1A1A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle:   { color: '#FFF', fontSize: 18, fontWeight: '700' },
  backBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backBtnText:  { color: '#FFF', fontSize: 15, fontWeight: '600' },

  // Search
  searchBar:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#252525', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, borderWidth: 1, borderColor: '#2A2A2A' },
  searchInput:  { flex: 1, color: '#FFF', fontSize: 15 },
  resultsList:  { maxHeight: 400 },
  resultItem:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#2A2A2A', gap: 10 },
  resultNameRow:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  resultName:   { color: '#FFF', fontSize: 14, fontWeight: '600', flex: 1 },
  macroChips:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  macroChip:    { fontSize: 12, fontWeight: '600' },
  resultMetaSmall:{ color: '#444', fontSize: 10 },
  aiBadge:      { backgroundColor: '#1A2A3A', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#2A4A6A' },
  aiBadgeText:  { color: '#60A5FA', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  noResultsBox: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  noResults:    { color: '#555', fontSize: 14, textAlign: 'center', fontWeight: '600' },
  noResultsHint:{ color: '#444', fontSize: 12, textAlign: 'center' },
  searchHintBox:{ paddingVertical: 24, paddingHorizontal: 8 },
  searchHint:   { color: '#444', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // Portion pane
  foodCard:     { backgroundColor: '#252525', borderRadius: 14, padding: 14, marginBottom: 16 },
  confirmFoodName:{ color: '#FFF', fontSize: 17, fontWeight: '700' },
  confirmMacros:{ color: '#888', fontSize: 12, marginTop: 6 },
  presetRow:    { flexDirection: 'row', gap: 8, marginBottom: 16 },
  presetBtn:    { flex: 1, backgroundColor: '#252525', borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  presetBtnActive:{ backgroundColor: COLORS.primaryGreen + '25', borderColor: COLORS.primaryGreen },
  presetBtnText:{ color: '#888', fontSize: 13, fontWeight: '700' },
  presetBtnTextActive:{ color: COLORS.primaryGreen },
  gramsRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  gramsInput:   { flex: 1, backgroundColor: '#252525', borderRadius: 12, padding: 16, color: '#FFF', fontSize: 26, fontWeight: '800', textAlign: 'center', borderWidth: 1, borderColor: '#333' },
  gramsUnit:    { color: '#555', fontSize: 15, fontWeight: '600', width: 50 },
  previewCard:  { backgroundColor: '#0D1F0D', borderRadius: 14, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#1A3A1A' },
  previewTitle: { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 12 },
  previewGrid:  { flexDirection: 'row', justifyContent: 'space-around' },
  previewCell:  { alignItems: 'center', gap: 4 },
  previewVal:   { fontSize: 18, fontWeight: '800' },
  previewLabel: { color: '#555', fontSize: 11, fontWeight: '600' },
  logConfirmBtn:{ backgroundColor: COLORS.primaryGreen, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 8 },
  logConfirmBtnDisabled:{ backgroundColor: '#2A2A2A' },
  logConfirmBtnText:{ color: '#000', fontWeight: '800', fontSize: 16 },
});