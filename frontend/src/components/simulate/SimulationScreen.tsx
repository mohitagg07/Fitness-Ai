// VYRN — What If? Simulation Engine
// Priority 5: Users pick a scenario + time horizon and see projected metrics
// with confidence scores, timelines, and VYRN's recommendation.
// Uses a custom slider (no external dependency).

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { simulationApi, describeApiError } from '../../utils/api';

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
  has_data?: boolean;
  data_note?: string;
  n_points?: number;
}

// ── Data ──────────────────────────────────────────────────────────────────────
const SCENARIOS: Scenario[] = [
  { id: 'protein',      icon: 'restaurant-outline', label: 'Protein +30 g/day' },
  { id: 'missWorkouts', icon: 'play-skip-forward-outline', label: 'Miss 2 workouts/wk' },
  { id: 'sleep',        icon: 'moon-outline',       label: 'Sleep +1 hr/night' },
  { id: 'calSurplus',   icon: 'flame-outline',      label: 'Calorie surplus +300' },
];

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

  const [error, setError] = useState<string | null>(null);

  const simulate = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const response = await simulationApi.runScenario(selected, weeks);
      setResult(response.data as SimResult);
    } catch (err) {
      setError(describeApiError(err).message);
    } finally {
      setLoading(false);
    }
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

      {error && !loading && (
        <View style={styles.errorCard} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={20} color={COLORS.recoveryLow} />
          <Text style={styles.errorText}>{error}</Text>
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
              <Text style={styles.confEyebrow}>ESTIMATE CONFIDENCE</Text>
              <Text style={styles.confValue}>{result.confidence}%</Text>
            </View>
          </View>

          {result.data_note && (
            <View style={[
              styles.dataNote,
              { borderColor: result.has_data ? COLORS.cardBorder : COLORS.recoveryMed },
            ]}>
              <Ionicons
                name={result.has_data ? 'analytics-outline' : 'information-circle-outline'}
                size={16}
                color={result.has_data ? COLORS.strain : COLORS.recoveryMed}
              />
              <Text style={styles.dataNoteText}>{result.data_note}</Text>
            </View>
          )}

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
          <Text style={styles.disclaimer}>
            Directional estimate, not a guarantee or a medical prediction.
            Confidence reflects the model's data coverage, not a statistical probability.
          </Text>
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
    borderWidth: 1, borderColor: COLORS.cardBorder, padding: 14,
  },
  dataNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: 9, padding: 10, marginBottom: 12,
    backgroundColor: COLORS.cardElevated,
  },
  dataNoteText: {
    flex: 1, fontFamily: FONTS.regular, fontSize: 11,
    color: COLORS.textSecondary, lineHeight: 16,
  },
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.card, borderColor: COLORS.recoveryLow,
    borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14,
  },
  errorText: {
    flex: 1, fontFamily: FONTS.regular, fontSize: 12,
    color: COLORS.textSecondary, lineHeight: 17,
  },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  resultEyebrow: {
    fontFamily: FONTS.bold, fontSize: 10, fontWeight: '700', letterSpacing: 1.3,
    color: COLORS.strainGlow, textTransform: 'uppercase', marginBottom: 4,
  },
  resultHeadline: { fontFamily: FONTS.semibold, fontSize: 15, fontWeight: '600', color: COLORS.text },
  confBlock: { alignItems: 'flex-end' },
  confEyebrow: {
    fontFamily: FONTS.bold, fontSize: 10, fontWeight: '700', letterSpacing: 1.1,
    color: COLORS.textMuted, textTransform: 'uppercase', marginBottom: 2,
  },
  confValue: { fontFamily: FONTS.numericBold, fontSize: 22, fontWeight: '800', color: COLORS.strainGlow },

  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  metricCell: {
    width: '48%', backgroundColor: COLORS.cardElevated,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.borderLight, padding: 10,
  },
  metricLabel: {
    fontFamily: FONTS.bold, fontSize: 10, fontWeight: '700', letterSpacing: 0.8,
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
    fontFamily: FONTS.bold, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 5,
  },
  boxText: { fontFamily: FONTS.regular, fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  disclaimer: {
    fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15,
    color: COLORS.textMuted, marginTop: 10,
  },
});