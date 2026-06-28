/**
 * StrengthProgressionChart
 * Renders a bar chart of weekly best weight for a given exercise.
 * Uses react-native-svg (already a dep via expo SDK).
 * Called from ProgressScreen's new "Strength" tab.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, TextInput,
} from 'react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { workoutApi } from '../../utils/api';
import { COLORS } from '../../theme/colors';

interface ProgressPoint {
  week: string;
  weight_kg: number;
  date: string;
}

const QUICK_PICKS = ['Bench Press', 'Squat', 'Deadlift', 'OHP', 'Row'];
const CHART_W = 320;
const CHART_H = 140;
const BAR_PAD = 6;

export default function StrengthProgressionChart() {
  const [exercise, setExercise] = useState('Bench Press');
  const [inputVal, setInputVal] = useState('');
  const [data, setData] = useState<ProgressPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadProgression(exercise);
  }, [exercise]);

  const loadProgression = async (ex: string) => {
    setLoading(true);
    try {
      const res = await workoutApi.getStrengthProgression(ex, 8);
      setData(res.data || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomSearch = () => {
    const val = inputVal.trim();
    if (val.length > 1) {
      setExercise(val);
      setInputVal('');
    }
  };

  const maxWeight = data.length > 0 ? Math.max(...data.map(d => d.weight_kg)) : 1;
  const barWidth = data.length > 0
    ? Math.max(16, (CHART_W - BAR_PAD * (data.length + 1)) / data.length)
    : 30;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>STRENGTH PROGRESSION</Text>

      {/* Quick-pick exercise buttons */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picks}>
        {QUICK_PICKS.map(ex => (
          <TouchableOpacity
            key={ex}
            style={[styles.pick, exercise === ex && styles.pickActive]}
            onPress={() => setExercise(ex)}
          >
            <Text style={[styles.pickText, exercise === ex && styles.pickTextActive]}>
              {ex}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Custom exercise search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Custom exercise…"
          placeholderTextColor="#555"
          value={inputVal}
          onChangeText={setInputVal}
          onSubmitEditing={handleCustomSearch}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchBtn} onPress={handleCustomSearch}>
          <Text style={styles.searchBtnText}>Go</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.exerciseTitle}>{exercise}</Text>

      {loading ? (
        <ActivityIndicator color={COLORS.primaryGreen} style={{ marginTop: 20 }} />
      ) : data.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No data yet for {exercise}.</Text>
          <Text style={styles.emptyHint}>Log sets during a session to see progression.</Text>
        </View>
      ) : (
        <View style={styles.chartWrap}>
          <Svg width={CHART_W} height={CHART_H + 30}>
            {/* Baseline */}
            <Line
              x1={0} y1={CHART_H} x2={CHART_W} y2={CHART_H}
              stroke="#333" strokeWidth={1}
            />
            {data.map((point, i) => {
              const barH = Math.max(4, (point.weight_kg / maxWeight) * (CHART_H - 20));
              const x = BAR_PAD + i * (barWidth + BAR_PAD);
              const y = CHART_H - barH;
              const isLast = i === data.length - 1;
              return (
                <React.Fragment key={i}>
                  <Rect
                    x={x} y={y} width={barWidth} height={barH}
                    fill={isLast ? COLORS.primaryGreen : '#2A4A3A'}
                    rx={3}
                  />
                  {/* Weight label on top of bar */}
                  {barH > 20 && (
                    <SvgText
                      x={x + barWidth / 2} y={y + 12}
                      fill={isLast ? '#000' : '#888'}
                      fontSize={9} textAnchor="middle" fontWeight="700"
                    >
                      {point.weight_kg}
                    </SvgText>
                  )}
                  {/* Week label below baseline */}
                  <SvgText
                    x={x + barWidth / 2} y={CHART_H + 14}
                    fill="#555" fontSize={8} textAnchor="middle"
                  >
                    {point.week.split('-W')[1] ? `W${point.week.split('-W')[1]}` : point.date.slice(5)}
                  </SvgText>
                </React.Fragment>
              );
            })}
          </Svg>

          {/* Summary stats */}
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{data[data.length - 1]?.weight_kg}kg</Text>
              <Text style={styles.statLabel}>Current best</Text>
            </View>
            {data.length > 1 && (
              <View style={styles.stat}>
                <Text style={[
                  styles.statVal,
                  (data[data.length - 1].weight_kg - data[0].weight_kg) >= 0
                    ? styles.statGreen : styles.statRed
                ]}>
                  {(data[data.length - 1].weight_kg - data[0].weight_kg) >= 0 ? '+' : ''}
                  {(data[data.length - 1].weight_kg - data[0].weight_kg).toFixed(1)}kg
                </Text>
                <Text style={styles.statLabel}>8-week change</Text>
              </View>
            )}
            <View style={styles.stat}>
              <Text style={styles.statVal}>{data.length}</Text>
              <Text style={styles.statLabel}>Weeks tracked</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 24 },
  label: {
    color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10,
  },
  picks: { marginBottom: 10 },
  pick: {
    backgroundColor: '#1C1C1C', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 14,
    marginRight: 8, borderWidth: 1, borderColor: '#2A2A2A',
  },
  pickActive: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  pickText: { color: '#888', fontSize: 12, fontWeight: '600' },
  pickTextActive: { color: '#000' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  searchInput: {
    flex: 1, backgroundColor: '#1C1C1C', borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 8, color: '#FFF', fontSize: 13, borderWidth: 1, borderColor: '#2A2A2A',
  },
  searchBtn: {
    backgroundColor: '#1C1C1C', borderRadius: 8, paddingHorizontal: 16,
    paddingVertical: 8, borderWidth: 1, borderColor: '#2A2A2A', justifyContent: 'center',
  },
  searchBtnText: { color: COLORS.primaryGreen, fontSize: 13, fontWeight: '600' },
  exerciseTitle: { color: '#DDD', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  chartWrap: {
    backgroundColor: '#1C1C1C', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  empty: { alignItems: 'center', paddingVertical: 24 },
  emptyText: { color: '#666', fontSize: 14, marginBottom: 4 },
  emptyHint: { color: '#444', fontSize: 12 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 },
  stat: { alignItems: 'center' },
  statVal: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  statGreen: { color: '#4CAF50' },
  statRed: { color: '#FF5252' },
  statLabel: { color: '#666', fontSize: 10, marginTop: 2 },
});
