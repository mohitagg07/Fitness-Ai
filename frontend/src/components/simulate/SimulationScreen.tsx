// VYRN — What If? Simulation Engine
// Priority 5: Users pick a scenario + time horizon and see projected metrics
// with confidence scores, timelines, and VYRN's recommendation.
// Uses a custom slider (no external dependency).

import React, { useState, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, PanResponder, GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';

// ── Types ─────────────────────────────────────────────────────────────────────
type ScenarioId = 'protein' | 'missWorkouts' | 'sleep' | 'calSurplus';

interface Scenario {
  id: ScenarioId;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}

interface SimMetric {
  label: string;
  value: string;
  positive: boolean | null;
}

interface SimResult {
  headline: string;
  metrics: SimMetric[];
  confidence: number;
  timeline: string;
  recommendation: string;
}

// ── Data ──────────────────────────────────────────────────────────────────────
const SCENARIOS: Scenario[] = [
  { id: 'protein',      icon: 'restaurant-outline', label: 'Protein +30 g/day' },
  { id: 'missWorkouts', icon: 'play-skip-forward-outline', label: 'Miss 2 workouts/wk' },
  { id: 'sleep',        icon: 'moon-outline',       label: 'Sleep +1 hr/night' },
  { id: 'calSurplus',   icon: 'flame-outline',      label: 'Calorie surplus +300' },
];

function runSimulation(id: ScenarioId, weeks: number): SimResult {
  const results: Record<ScenarioId, SimResult> = {
    protein: {
      headline: 'Accelerated muscle synthesis',
      metrics: [
        { label: 'Lean Mass Gain',       value: `+${(weeks * 0.18).toFixed(1)} kg`, positive: true  },
        { label: 'Strength Progression', value: `+${(weeks * 2.1).toFixed(0)}%`,    positive: true  },
        { label: 'Recovery Rate',        value: '+12% faster',                       positive: true  },
        { label: 'Calorie Cost',         value: `+${weeks * 30 * 4} kcal total`,    positive: null  },
      ],
      confidence: 83,
      timeline: `Noticeable difference in ~${Math.ceil(weeks / 2)} weeks`,
      recommendation: 'Optimal. Distribute across 4+ meals. Prioritize post-workout window.',
    },
    missWorkouts: {
      headline: 'Moderate strength retention loss',
      metrics: [
        { label: 'Strength Retention', value: `${100 - weeks * 3}%`,             positive: null  },
        { label: 'Muscle Loss Risk',   value: weeks > 2 ? 'Elevated' : 'Low',    positive: false },
        { label: 'Recovery Bounce',    value: 'Full in ~3 sessions',              positive: true  },
        { label: 'Volume Deficit',     value: `-${weeks * 2} sets/muscle group`,  positive: false },
      ],
      confidence: 76,
      timeline: `Regression begins after day ${5 + weeks * 2}`,
      recommendation: 'Add an extra set to surrounding sessions. Protein ≥2 g/kg prevents catabolism.',
    },
    sleep: {
      headline: 'Significant recovery & hormonal gains',
      metrics: [
        { label: 'HRV Improvement',    value: `+${(weeks * 3.2).toFixed(0)} ms`, positive: true },
        { label: 'Testosterone Boost', value: '+8-15% in 2 weeks',               positive: true },
        { label: 'Recovery Score',     value: `+${(weeks * 1.4).toFixed(1)} pts`,positive: true },
        { label: 'Performance Output', value: '+6% peak power',                   positive: true },
      ],
      confidence: 91,
      timeline: 'Day 4-7 for measurable HRV change',
      recommendation: 'Highest ROI change available. Prioritize above any supplement stack.',
    },
    calSurplus: {
      headline: 'Lean mass gain with moderate fat increase',
      metrics: [
        { label: 'Lean Mass Gain',       value: `+${(weeks * 0.12).toFixed(1)} kg`, positive: true  },
        { label: 'Fat Mass Gain',        value: `+${(weeks * 0.08).toFixed(1)} kg`, positive: false },
        { label: 'Strength Progression', value: `+${(weeks * 1.8).toFixed(0)}%`,    positive: true  },
        { label: 'Weekly Weight Gain',   value: '+0.2 kg/week target',              positive: null  },
      ],
      confidence: 71,
      timeline: `Measurable body composition shift in ${weeks + 1} weeks`,
      recommendation: 'Acceptable surplus. Monitor weekly. Reduce to +150 if fat gain exceeds 0.1 kg/week.',
    },
  };
  return results[id];
}

// ── Custom Slider ─────────────────────────────────────────────────────────────
function WeeksSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const MIN = 1, MAX = 12;
  const STEPS = Array.from({ length: MAX - MIN + 1 }, (_, i) => i + MIN);

  return (
    <View style={sl.row}>
      {STEPS.map((step) => (
        <TouchableOpacity
          key={step}
          style={[
            sl.pip,
            {
              backgroundColor: step <= value ? COLORS.recoveryHigh : '#1F1F1F',
              transform: [{ scale: step === value ? 1.3 : 1 }],
            },
          ]}
          onPress={() => onChange(step)}
        />
      ))}
    </View>
  );
}

const sl = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 8,
  },
  pip: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function SimulationScreen() {
  const [selected, setSelected] = useState<ScenarioId>('protein');
  const [weeks,    setWeeks]    = useState(4);
  const [result,   setResult]   = useState<SimResult | null>(null);
  const [loading,  setLoading]  = useState(false);

  const simulate = async () => {
    setLoading(true);
    setResult(null);
    await new Promise((r) => setTimeout(r, 1200));
    setResult(runSimulation(selected, weeks));
    setLoading(false);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>What If Engine</Text>
      <Text style={styles.subtitle}>Simulate changes before committing</Text>

      {/* Scenario grid */}
      <Text style={styles.sectionLabel}>What if I change…</Text>
      <View style={styles.grid}>
        {SCENARIOS.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.scenarioBtn, selected === s.id && styles.scenarioBtnActive]}
            onPress={() => setSelected(s.id)}
          >
            <Ionicons
              name={s.icon}
              size={22}
              color={selected === s.id ? COLORS.recoveryHigh : '#888'}
              style={styles.scenarioIcon}
            />
            <Text style={[styles.scenarioLabel, selected === s.id && { color: COLORS.recoveryHigh }]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Time horizon */}
      <View style={styles.sliderCard}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sectionLabel}>Time horizon</Text>
          <Text style={styles.weeksValue}>{weeks} {weeks === 1 ? 'week' : 'weeks'}</Text>
        </View>
        <WeeksSlider value={weeks} onChange={setWeeks} />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderEdge}>1 week</Text>
          <Text style={styles.sliderEdge}>12 weeks</Text>
        </View>
      </View>

      {/* Run button */}
      <TouchableOpacity
        style={[styles.runBtn, loading && { opacity: 0.5 }]}
        onPress={simulate}
        disabled={loading}
      >
        <Ionicons name="flash" size={16} color="#0A0A0A" style={{ marginRight: 6 }} />
        <Text style={styles.runBtnText}>Run Simulation</Text>
      </TouchableOpacity>

      {/* Loading */}
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.strainGlow} size="small" />
          <Text style={styles.loadingText}>COMPUTING…</Text>
          <View style={styles.skeletonRow}>
            {['Biomechanics', 'Recovery', 'Volume', 'Adaptation'].map((s) => (
              <View key={s} style={styles.skeleton}>
                <Text style={styles.skeletonText}>{s}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Result */}
      {result && !loading && (
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultEyebrow}>SIMULATION RESULT</Text>
              <Text style={styles.resultHeadline}>{result.headline}</Text>
            </View>
            <View style={styles.confBlock}>
              <Text style={styles.confEyebrow}>CONFIDENCE</Text>
              <Text style={styles.confValue}>{result.confidence}%</Text>
            </View>
          </View>

          <View style={styles.metricsGrid}>
            {result.metrics.map((m, i) => (
              <View key={i} style={styles.metricCell}>
                <Text style={styles.metricLabel}>{m.label}</Text>
                <Text
                  style={[
                    styles.metricValue,
                    {
                      color:
                        m.positive === true  ? COLORS.recoveryHigh :
                        m.positive === false ? COLORS.recoveryLow  : COLORS.text,
                    },
                  ]}
                >
                  {m.value}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.timelineBox}>
            <Text style={[styles.boxLabel, { color: COLORS.strain }]}>TIMELINE</Text>
            <Text style={styles.boxText}>{result.timeline}</Text>
          </View>

          <View style={styles.recBox}>
            <Text style={[styles.boxLabel, { color: COLORS.recoveryHigh }]}>RECOMMENDATION</Text>
            <Text style={styles.boxText}>{result.recommendation}</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 40 },

  title: {
    fontFamily: FONTS.bold, fontSize: 22, fontWeight: '700',
    color: COLORS.text, marginBottom: 4,
  },
  subtitle: {
    fontFamily: FONTS.regular, fontSize: 13,
    color: COLORS.textSecondary, marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: FONTS.bold, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.3, color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: 10,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  scenarioBtn: {
    width: '48%', backgroundColor: COLORS.cardElevated, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.borderLight, padding: 12,
  },
  scenarioBtnActive: { borderColor: COLORS.recoveryHigh, backgroundColor: '#16EC0610' },
  scenarioIcon:  { marginBottom: 6 },
  scenarioLabel: { fontFamily: FONTS.medium, fontSize: 12, fontWeight: '500', color: COLORS.textSecondary },

  sliderCard: {
    backgroundColor: COLORS.cardElevated, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.borderLight, padding: 14, marginBottom: 14,
  },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  weeksValue: { fontFamily: FONTS.numericBold, fontSize: 16, fontWeight: '700', color: COLORS.strainGlow },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  sliderEdge: { fontFamily: FONTS.regular, fontSize: 10, color: COLORS.textMuted },

  runBtn: {
    backgroundColor: COLORS.recoveryHigh, borderRadius: 10,
    padding: 14, alignItems: 'center', marginBottom: 16,
    flexDirection: 'row', justifyContent: 'center',
  },
  runBtnText: { fontFamily: FONTS.bold, fontSize: 13, fontWeight: '700', color: '#000', letterSpacing: 0.5 },

  loadingContainer: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  loadingText: { fontFamily: FONTS.numericMedium, fontSize: 12, color: COLORS.strainGlow, letterSpacing: 1.5 },
  skeletonRow: { flexDirection: 'row', gap: 8 },
  skeleton: { backgroundColor: '#161616', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  skeletonText: { fontFamily: FONTS.regular, fontSize: 10, color: COLORS.textMuted },

  resultCard: {
    backgroundColor: COLORS.card, borderRadius: 12,
    borderWidth: 1, borderColor: '#00F19F30', padding: 14,
  },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  resultEyebrow: {
    fontFamily: FONTS.bold, fontSize: 9, fontWeight: '700', letterSpacing: 1.3,
    color: COLORS.strainGlow, textTransform: 'uppercase', marginBottom: 4,
  },
  resultHeadline: { fontFamily: FONTS.semibold, fontSize: 15, fontWeight: '600', color: COLORS.text },
  confBlock: { alignItems: 'flex-end' },
  confEyebrow: {
    fontFamily: FONTS.bold, fontSize: 9, fontWeight: '700', letterSpacing: 1.1,
    color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: 2,
  },
  confValue: { fontFamily: FONTS.numericBold, fontSize: 22, fontWeight: '800', color: COLORS.strainGlow },

  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  metricCell: {
    width: '48%', backgroundColor: COLORS.cardElevated,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.borderLight, padding: 10,
  },
  metricLabel: {
    fontFamily: FONTS.bold, fontSize: 9, fontWeight: '700', letterSpacing: 0.8,
    color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: 6,
  },
  metricValue: { fontFamily: FONTS.numericBold, fontSize: 14, fontWeight: '700' },

  timelineBox: {
    backgroundColor: '#0093E710', borderRadius: 8,
    borderWidth: 1, borderColor: '#0093E730', padding: 10, marginBottom: 8,
  },
  recBox: {
    backgroundColor: '#16EC0610', borderRadius: 8,
    borderWidth: 1, borderColor: '#16EC0630', padding: 10,
  },
  boxLabel: {
    fontFamily: FONTS.bold, fontSize: 9, fontWeight: '700',
    letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 5,
  },
  boxText: { fontFamily: FONTS.regular, fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
});