// VYRN — Weekly Coach Review Screen
//
// Shows the AI-generated weekly review every Sunday (or on-demand):
//   - Workout consistency ring
//   - Strength gains
//   - Nutrition adherence
//   - Best lift of the week
//   - Highlights & areas that need attention
//   - Personalized next-week strategy from the AI coach
//   - Transparent reasoning (why the coach said what it said)

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { reviewApi, describeApiError } from '../../utils/api';
import { COLORS } from '../../theme/colors';

interface WeeklyReview {
  week_label: string;
  consistency_pct: number;
  sessions_completed: number;
  sessions_planned: number;
  avg_recovery_score: number;
  avg_protein_g: number;
  protein_target_g: number;
  protein_adherence_pct: number;
  avg_calories: number;
  calories_target: number;
  calories_adherence_pct: number;
  best_lift: { exercise: string; weight_kg: number; reps: number };
  strength_gains: Array<{ exercise: string; prev_kg: number; curr_kg: number; delta_kg: number }>;
  highlights: string[];
  needs_attention: string[];
  next_week_strategy: string;
  confidence: string;
  generated_at: string;
}

// Small arc/ring component
function RingMeter({ pct, color, label, size = 72 }: {
  pct: number; color: string; label: string; size?: number;
}) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const filled = circ * Math.min(pct, 100) / 100;

  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2},${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke="#222" strokeWidth={6} fill="none" />
          <Circle
            cx={size / 2} cy={size / 2} r={r}
            stroke={color} strokeWidth={6} fill="none"
            strokeDasharray={`${filled} ${circ - filled}`}
            strokeLinecap="round"
          />
        </G>
        <SvgText
          x={size / 2} y={size / 2 + 5}
          textAnchor="middle"
          fill={color}
          fontSize={15}
          fontWeight="700"
        >
          {pct}%
        </SvgText>
      </Svg>
      <Text style={[styles.ringLabel, { color: COLORS.textDim }]}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function BulletRow({ text, icon, color }: { text: string; icon: string; color: string }) {
  return (
    <View style={styles.bulletRow}>
      <Ionicons name={icon as any} size={14} color={color} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

export default function WeeklyReviewScreen() {
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [weeksAgo, setWeeksAgo] = useState(0);

  const loadReview = useCallback(async () => {
    setError(null);
    try {
      const res = await reviewApi.getWeekly(weeksAgo);
      setReview(res.data);
    } catch (err: any) {
      const { message } = describeApiError(err);
      setError(message);
    }
  }, [weeksAgo]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadReview();
      setLoading(false);
    })();
  }, [loadReview]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReview();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.recoveryHigh} size="large" />
        <Text style={styles.loadingText}>Coach is reviewing your week...</Text>
      </View>
    );
  }

  if (error || !review) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={40} color={COLORS.textDim} />
        <Text style={styles.errorText}>{error || 'Could not load weekly review'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRefresh}>
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const consistencyColor =
    review.consistency_pct >= 80 ? COLORS.recoveryHigh :
    review.consistency_pct >= 50 ? COLORS.recoveryMed : COLORS.recoveryLow;

  const proteinColor =
    review.protein_adherence_pct >= 85 ? COLORS.recoveryHigh :
    review.protein_adherence_pct >= 65 ? COLORS.recoveryMed : COLORS.recoveryLow;

  const calorieColor =
    review.calories_adherence_pct >= 85 ? COLORS.recoveryHigh :
    review.calories_adherence_pct >= 65 ? COLORS.recoveryMed : COLORS.recoveryLow;

  const recoveryColor =
    review.avg_recovery_score >= 7 ? COLORS.recoveryHigh :
    review.avg_recovery_score >= 4 ? COLORS.recoveryMed : COLORS.recoveryLow;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.recoveryHigh} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Coach Review</Text>
        <Text style={styles.weekLabel}>{review.week_label}</Text>
        <View style={styles.weekNav}>
          <TouchableOpacity
            style={styles.weekNavBtn}
            onPress={() => setWeeksAgo(w => w + 1)}
          >
            <Ionicons name="chevron-back" size={16} color={COLORS.textDim} />
            <Text style={styles.weekNavText}>Previous</Text>
          </TouchableOpacity>
          {weeksAgo > 0 && (
            <TouchableOpacity
              style={styles.weekNavBtn}
              onPress={() => setWeeksAgo(w => w - 1)}
            >
              <Text style={styles.weekNavText}>Next</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textDim} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Metrics rings */}
      <View style={styles.ringsRow}>
        <RingMeter pct={review.consistency_pct} color={consistencyColor} label="Consistency" />
        <RingMeter pct={review.protein_adherence_pct} color={proteinColor} label="Protein" />
        <RingMeter pct={review.calories_adherence_pct} color={calorieColor} label="Calories" />
        <RingMeter pct={review.avg_recovery_score * 10} color={recoveryColor} label="Recovery" />
      </View>

      {/* Sessions */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{review.sessions_completed}</Text>
          <Text style={styles.statLabel}>Sessions</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: COLORS.recoveryHigh }]}>
            {review.avg_protein_g.toFixed(0)}g
          </Text>
          <Text style={styles.statLabel}>Avg Protein</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{review.avg_calories}</Text>
          <Text style={styles.statLabel}>Avg Calories</Text>
        </View>
      </View>

      {/* Best Lift */}
      {review.best_lift?.exercise && (
        <Section title="Best Lift">
          <View style={styles.bestLiftCard}>
            <Ionicons name="trophy-outline" size={20} color={COLORS.recoveryMed} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bestLiftExercise}>{review.best_lift.exercise}</Text>
              <Text style={styles.bestLiftWeight}>
                {review.best_lift.weight_kg}kg × {review.best_lift.reps} reps
              </Text>
            </View>
          </View>
        </Section>
      )}

      {/* Strength Gains */}
      {review.strength_gains.length > 0 && (
        <Section title="Strength Gains">
          {review.strength_gains.map((g, i) => (
            <View key={i} style={styles.gainRow}>
              <Text style={styles.gainExercise}>{g.exercise}</Text>
              <View style={styles.gainRight}>
                <Text style={styles.gainDelta}>+{g.delta_kg}kg</Text>
                <Text style={styles.gainDetail}>{g.prev_kg}→{g.curr_kg}kg</Text>
              </View>
            </View>
          ))}
        </Section>
      )}

      {/* Highlights */}
      {review.highlights.length > 0 && (
        <Section title="Highlights">
          {review.highlights.map((h, i) => (
            <BulletRow key={i} text={h} icon="checkmark-circle-outline" color={COLORS.recoveryHigh} />
          ))}
        </Section>
      )}

      {/* Needs Attention */}
      {review.needs_attention.length > 0 && (
        <Section title="Needs Attention">
          {review.needs_attention.map((n, i) => (
            <BulletRow key={i} text={n} icon="alert-circle-outline" color={COLORS.recoveryMed} />
          ))}
        </Section>
      )}

      {/* Next Week Strategy */}
      <Section title="Next Week Strategy">
        <View style={styles.strategyCard}>
          <Text style={styles.strategyText}>{review.next_week_strategy}</Text>
          <View style={styles.confidenceRow}>
            <View style={[styles.confidenceDot, {
              backgroundColor:
                review.confidence === 'High' ? COLORS.recoveryHigh :
                review.confidence === 'Medium' ? COLORS.recoveryMed : COLORS.recoveryLow
            }]} />
            <Text style={styles.confidenceLabel}>
              {review.confidence} confidence · based on {
                review.sessions_completed} session{review.sessions_completed !== 1 ? 's' : ''} this week
            </Text>
          </View>
        </View>
      </Section>

      {/* Transparent Reasoning Toggle */}
      <TouchableOpacity
        style={styles.whyBtn}
        onPress={() => setShowReasoning(v => !v)}
      >
        <Ionicons
          name={showReasoning ? 'chevron-up-outline' : 'help-circle-outline'}
          size={16}
          color={COLORS.textDim}
        />
        <Text style={styles.whyBtnText}>
          {showReasoning ? 'Hide reasoning' : 'Why did the coach say this?'}
        </Text>
      </TouchableOpacity>

      {showReasoning && (
        <View style={styles.reasoningCard}>
          <Text style={styles.reasoningTitle}>Coach's Reasoning</Text>
          <Text style={styles.reasoningBody}>
            This review was generated from{' '}
            <Text style={{ color: COLORS.recoveryHigh }}>{review.sessions_completed} workout sessions</Text>,{' '}
            <Text style={{ color: COLORS.recoveryHigh }}>{review.avg_protein_g.toFixed(0)}g avg protein</Text>,{' '}
            and a recovery average of{' '}
            <Text style={{ color: COLORS.recoveryHigh }}>{review.avg_recovery_score}/10</Text>.
            {review.strength_gains.length > 0 &&
              ` Strength data from ${review.strength_gains.length} exercise${review.strength_gains.length > 1 ? 's' : ''} was compared against the previous week.`}
            {' '}Confidence is {review.confidence.toLowerCase()} because {
              review.confidence === 'High'
                ? 'sufficient data exists across workouts, nutrition, and exercises.'
                : review.confidence === 'Medium'
                ? 'some data categories have limited entries this week.'
                : 'minimal data was available — log more sessions and nutrition for better insights.'
            }
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: COLORS.textDim, fontSize: 14 },
  errorText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', marginHorizontal: 32 },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#222', borderRadius: 8 },
  retryText: { color: '#fff', fontSize: 14 },

  header: { padding: 20, paddingTop: 16 },
  headerTitle: { color: '#fff', fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  weekLabel: { color: COLORS.textDim, fontSize: 13, marginTop: 2 },
  weekNav: { flexDirection: 'row', gap: 12, marginTop: 12 },
  weekNavBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  weekNavText: { color: COLORS.textDim, fontSize: 13 },

  ringsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  ringLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },

  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '700' },
  statLabel: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },

  section: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#111' },
  sectionTitle: { color: COLORS.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },

  bestLiftCard: {
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bestLiftExercise: { color: '#fff', fontSize: 15, fontWeight: '600' },
  bestLiftWeight: { color: COLORS.recoveryMed, fontSize: 13, marginTop: 2 },

  gainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  gainExercise: { color: '#fff', fontSize: 14 },
  gainRight: { alignItems: 'flex-end' },
  gainDelta: { color: COLORS.recoveryHigh, fontSize: 15, fontWeight: '700' },
  gainDetail: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5 },
  bulletText: { color: COLORS.textMuted, fontSize: 13, flex: 1, lineHeight: 18 },

  strategyCard: {
    backgroundColor: '#0a1a0a',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.recoveryHigh + '30',
  },
  strategyText: { color: '#fff', fontSize: 14, lineHeight: 22 },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  confidenceDot: { width: 6, height: 6, borderRadius: 3 },
  confidenceLabel: { color: COLORS.textDim, fontSize: 11 },

  whyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
  },
  whyBtnText: { color: COLORS.textDim, fontSize: 13 },

  reasoningCard: {
    marginHorizontal: 16,
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#222',
  },
  reasoningTitle: { color: COLORS.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  reasoningBody: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20 },
});
