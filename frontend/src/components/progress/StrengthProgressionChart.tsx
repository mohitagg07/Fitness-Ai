import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { workoutApi, describeApiError } from '../../utils/api';
import { COLORS, alpha } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { RADIUS, SPACING } from '../../theme/spacing';

interface ProgressPoint {
  week: string;
  weight_kg: number;
  reps: number;
  date: string;
}

interface ProgressionResponse {
  exercise: string;
  data: ProgressPoint[];
}

const QUICK_PICKS = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press', 'Barbell Row'];
const CHART_HEIGHT = 150;
const CHART_TOP = 16;
const CHART_BOTTOM = 122;
const PAD_X = 12;

export default function StrengthProgressionChart() {
  const [exercise, setExercise] = useState('Bench Press');
  const [inputVal, setInputVal] = useState('');
  const [data, setData] = useState<ProgressPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartWidth, setChartWidth] = useState(320);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    workoutApi.getStrengthProgression(exercise, 8)
      .then((res) => {
        if (!active) return;
        const payload = res.data as ProgressionResponse | ProgressPoint[];
        const points = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as ProgressionResponse)?.data)
            ? (payload as ProgressionResponse).data
            : [];
        setData(points.filter((point) => Number.isFinite(Number(point.weight_kg))));
      })
      .catch((err) => {
        if (!active) return;
        setData([]);
        setError(describeApiError(err).message || 'Could not load this lift history.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [exercise, reloadKey]);

  const chooseExercise = (next: string) => {
    if (next.trim().length > 1 && next !== exercise) setExercise(next.trim());
  };

  const searchExercise = () => {
    const next = inputVal.trim();
    if (next.length > 1) {
      chooseExercise(next);
      setInputVal('');
    }
  };

  const width = Math.max(240, chartWidth);
  const values = data.map((point) => Number(point.weight_kg));
  const maxValue = values.length ? Math.max(...values) : 0;
  const spread = values.length ? Math.max(1, maxValue - Math.min(...values)) : 1;
  const chartMax = Math.max(1, maxValue + Math.max(5, spread * 0.18));
  const barGap = 8;
  const barWidth = data.length
    ? Math.max(12, (width - PAD_X * 2 - barGap * (data.length - 1)) / data.length)
    : 20;
  const plotHeight = CHART_BOTTOM - CHART_TOP;

  return (
    <View
      style={styles.container}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.width - SPACING.lg * 2);
        if (next > 0 && next !== chartWidth) setChartWidth(next);
      }}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>STRENGTH DEVELOPMENT</Text>
          <Text style={styles.title}>Lift progression</Text>
          <Text style={styles.description}>Best logged working weight by week · last 8 weeks</Text>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="trending-up" size={18} color={COLORS.primaryGreen} />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.picks} keyboardShouldPersistTaps="handled">
        {QUICK_PICKS.map((item) => {
          const active = exercise === item;
          return (
            <TouchableOpacity key={item} style={[styles.pick, active && styles.pickActive]} onPress={() => chooseExercise(item)} accessibilityRole="button" accessibilityState={{ selected: active }}>
              <Text style={[styles.pickText, active && styles.pickTextActive]}>{item}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search another exercise"
          placeholderTextColor={COLORS.textMuted}
          value={inputVal}
          onChangeText={setInputVal}
          onSubmitEditing={searchExercise}
          returnKeyType="search"
          keyboardAppearance="dark"
          selectionColor={COLORS.primaryGreen}
          underlineColorAndroid="transparent"
        />
        <TouchableOpacity style={styles.searchButton} onPress={searchExercise} accessibilityRole="button">
          <Text style={styles.searchButtonText}>VIEW</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.chartFrame}>
        <View style={styles.chartMeta}>
          <Text style={styles.exerciseName}>{exercise}</Text>
          <Text style={styles.unitLabel}>KG</Text>
        </View>

        {loading ? (
          <View style={styles.state}>
            <ActivityIndicator color={COLORS.primaryGreen} />
            <Text style={styles.stateText}>Loading logged sets…</Text>
          </View>
        ) : error ? (
          <View style={styles.state}>
            <Ionicons name="cloud-offline-outline" size={22} color={COLORS.recoveryMed} />
            <Text style={styles.stateTitle}>History unavailable</Text>
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity style={styles.retry} onPress={() => setReloadKey((value) => value + 1)}>
              <Ionicons name="refresh" size={13} color={COLORS.background} />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : data.length === 0 ? (
          <View style={styles.state}>
            <View style={styles.emptyIcon}><Ionicons name="barbell-outline" size={20} color={COLORS.textMuted} /></View>
            <Text style={styles.stateTitle}>No logged sets yet</Text>
            <Text style={styles.stateText}>Log working sets for {exercise} to build your weekly strength history.</Text>
          </View>
        ) : (
          <View style={styles.chartArea}>
            <Svg width={width} height={CHART_HEIGHT} viewBox={'0 0 ' + width + ' ' + CHART_HEIGHT}>
              {[0, 0.5, 1].map((ratio) => {
                const y = CHART_BOTTOM - plotHeight * ratio;
                const labelValue = Math.round((chartMax * ratio) / 5) * 5;
                return (
                  <React.Fragment key={ratio}>
                    <Line x1={PAD_X} y1={y} x2={width - PAD_X} y2={y} stroke={COLORS.border} strokeWidth={1} strokeDasharray="3 5" />
                    <SvgText x={PAD_X} y={y - 4} fill={COLORS.textDim} fontSize={8}>{labelValue}</SvgText>
                  </React.Fragment>
                );
              })}
              {data.map((point, index) => {
                const x = PAD_X + index * (barWidth + barGap);
                const barHeight = Math.max(4, (Number(point.weight_kg) / chartMax) * plotHeight);
                const y = CHART_BOTTOM - barHeight;
                const latest = index === data.length - 1;
                return (
                  <React.Fragment key={point.week + '-' + index}>
                    <Rect x={x} y={y} width={barWidth} height={barHeight} rx={Math.min(5, barWidth / 3)}
                      fill={latest ? COLORS.primaryGreen : alpha(COLORS.primaryGreen, 0.28)}
                      stroke={latest ? COLORS.primaryGreen : alpha(COLORS.primaryGreen, 0.13)} strokeWidth={1} />
                    {barWidth > 23 && (
                      <SvgText x={x + barWidth / 2} y={Math.max(CHART_TOP + 9, y - 5)} fill={COLORS.textSecondary} fontSize={8} fontWeight="600" textAnchor="middle">
                        {Math.round(Number(point.weight_kg))}
                      </SvgText>
                    )}
                    <SvgText x={x + barWidth / 2} y={CHART_HEIGHT - 8} fill={latest ? COLORS.primaryGreen : COLORS.textMuted} fontSize={8} textAnchor="middle">
                      {point.week.split('-W')[1] ? 'W' + point.week.split('-W')[1] : (point.date || '').slice(5)}
                    </SvgText>
                  </React.Fragment>
                );
              })}
            </Svg>
          </View>
        )}
      </View>

      {!loading && !error && data.length > 0 && (
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{Number(data[data.length - 1].weight_kg).toLocaleString()} kg</Text>
            <Text style={styles.statLabel}>LATEST WEEKLY BEST</Text>
          </View>
          {data.length > 1 && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: Number(data[data.length - 1].weight_kg) >= Number(data[0].weight_kg) ? COLORS.recoveryHigh : COLORS.recoveryMed }]}>
                  {(Number(data[data.length - 1].weight_kg) - Number(data[0].weight_kg) > 0 ? '+' : '') +
                    (Number(data[data.length - 1].weight_kg) - Number(data[0].weight_kg)).toFixed(1)} kg
                </Text>
                <Text style={styles.statLabel}>OBSERVED CHANGE</Text>
              </View>
            </>
          )}
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{data.length}</Text>
            <Text style={styles.statLabel}>WEEKS LOGGED</Text>
          </View>
        </View>
      )}
      <Text style={styles.footnote}>Weekly best working weight from your saved, non-warm-up sets. A missing week means no qualifying set was logged.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.card, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.cardBorder, padding: SPACING.lg, marginBottom: SPACING.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SPACING.sm, marginBottom: SPACING.md },
  headerCopy: { flex: 1, gap: 3 },
  headerIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: alpha(COLORS.primaryGreen, 0.10), borderWidth: 1, borderColor: alpha(COLORS.primaryGreen, 0.2), alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.3 },
  title: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 19, letterSpacing: -0.3 },
  description: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15 },
  picks: { gap: 7, paddingBottom: SPACING.sm },
  pick: { backgroundColor: COLORS.cardElevated, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.border },
  pickActive: { backgroundColor: alpha(COLORS.primaryGreen, 0.11), borderColor: alpha(COLORS.primaryGreen, 0.52) },
  pickText: { color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 10 },
  pickTextActive: { color: COLORS.primaryGreen },
  searchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, backgroundColor: COLORS.inputBg, borderRadius: RADIUS.button, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  searchInput: { flex: 1, minWidth: 0, color: COLORS.text, fontFamily: FONTS.regular, fontSize: 12, paddingVertical: 9 },
  searchButton: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: alpha(COLORS.primaryGreen, 0.12) },
  searchButtonText: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.6 },
  chartFrame: { borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.backgroundTop, padding: 12, overflow: 'hidden' },
  chartMeta: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 },
  exerciseName: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13 },
  unitLabel: { color: COLORS.textDim, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1 },
  chartArea: { alignItems: 'center', width: '100%' },
  state: { minHeight: 156, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14 },
  stateTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13, textAlign: 'center' },
  stateText: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  emptyIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.cardElevated, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: COLORS.primaryGreen, marginTop: 3 },
  retryText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 10 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md, gap: 8 },
  stat: { flex: 1, minWidth: 0, gap: 4 },
  statValue: { color: COLORS.text, fontFamily: FONTS.numericSemibold, fontSize: 15 },
  statLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 0.55, lineHeight: 10 },
  statDivider: { width: 1, height: 30, backgroundColor: COLORS.border },
  footnote: { color: COLORS.textDim, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 14, marginTop: SPACING.md },
});
