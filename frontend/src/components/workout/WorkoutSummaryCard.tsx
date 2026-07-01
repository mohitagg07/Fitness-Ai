/**
 * WorkoutSummaryCard — the Workout Complete event.
 *
 * Previously this was a plain stats grid. Finishing a workout is the
 * single moment in the app most worth making memorable, so this now:
 *   - count-up animates every number instead of snapping to a final value
 *   - fires a confetti burst + success haptic when there's a new PR
 *   - shows tomorrow's recovery % as a small ring, not just a word
 *   - surfaces the deterministic coach_message from the backend (see
 *     workouts.py's complete_session — grounded in this session's own
 *     numbers, never invented)
 *
 * Sound is intentionally not wired in yet — this app has no audio
 * dependency installed (expo-av/expo-audio), and I'm not silently adding
 * a new native module without being able to test the build here. Haptic
 * feedback covers the "felt" half of the celebration in the meantime.
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { COLORS } from '../../theme/colors';
import CountUpNumber from '../shared/CountUpNumber';
import ConfettiBurst from './ConfettiBurst';

interface NewPR {
  exercise_name: string;
  weight_kg: number;
  previous_pr_kg?: number | null;
  delta_kg?: number | null;
}

interface SummaryData {
  total_volume_kg: number;
  sets_logged: number;
  exercises: string[];
  exercise_count: number;
  best_set: {
    exercise: string;
    weight_kg: number;
    reps: number;
    rpe?: number;
  } | null;
  session_minutes?: number;
  new_prs?: NewPR[];
  recovery_pct?: number | null;
  recovery_prediction?: string | null;
  coach_message?: string | null;
}

interface Props {
  visible: boolean;
  data: SummaryData | null;
  onClose: () => void;
}

function recoveryColor(pct: number) {
  if (pct >= 70) return COLORS.recoveryHigh;
  if (pct >= 40) return COLORS.recoveryMed;
  return COLORS.recoveryLow;
}

function RecoveryRing({ pct }: { pct: number }) {
  const size = 56;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = recoveryColor(pct);
  const clamped = Math.max(0, Math.min(100, pct));
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="#222" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={[recStyles.pct, { color }]}>{Math.round(clamped)}%</Text>
    </View>
  );
}

export default function WorkoutSummaryCard({ visible, data, onClose }: Props) {
  const scaleIn = useRef(new Animated.Value(0.9)).current;
  const [confettiActive, setConfettiActive] = React.useState(false);

  useEffect(() => {
    if (!visible || !data) return;
    scaleIn.setValue(0.9);
    Animated.spring(scaleIn, { toValue: 1, useNativeDriver: true, friction: 7, tension: 70 }).start();

    const hasPRs = (data.new_prs?.length || 0) > 0;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (hasPRs) {
      // Small delay so the burst reads as a reaction to the PR badge appearing,
      // not a generic "modal opened" flourish.
      const t = setTimeout(() => setConfettiActive(true), 200);
      return () => clearTimeout(t);
    }
    setConfettiActive(false);
  }, [visible, data]);

  if (!data) return null;

  const prCount = data.new_prs?.length || 0;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.backdrop}>
        <ConfettiBurst active={confettiActive} />
        <Animated.View style={[styles.card, { transform: [{ scale: scaleIn }] }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.checkCircle, prCount > 0 && styles.checkCirclePR]}>
              <Ionicons name={prCount > 0 ? 'trophy' : 'checkmark'} size={28} color="#000" />
            </View>
            <Text style={styles.title}>Workout Complete</Text>
            <Text style={styles.subtitle}>
              {prCount > 0 ? `${prCount} new personal record${prCount !== 1 ? 's' : ''} today.` : 'Great work. Session saved.'}
            </Text>
          </View>

          {/* Stats grid — count-up */}
          <View style={styles.grid}>
            {data.session_minutes != null && (
              <View style={styles.stat}>
                <CountUpNumber value={data.session_minutes} style={styles.statVal} suffix="m" />
                <Text style={styles.statLabel}>Duration</Text>
              </View>
            )}
            <View style={styles.stat}>
              <CountUpNumber value={data.exercise_count} style={styles.statVal} />
              <Text style={styles.statLabel}>Exercises</Text>
            </View>
            <View style={styles.stat}>
              <CountUpNumber value={Math.round(data.total_volume_kg)} style={styles.statVal} suffix="kg" />
              <Text style={styles.statLabel}>Total volume</Text>
            </View>
            <View style={styles.stat}>
              <CountUpNumber value={prCount} style={[styles.statVal, prCount > 0 && { color: COLORS.recoveryMed }]} />
              <Text style={styles.statLabel}>PRs</Text>
            </View>
          </View>

          {/* PR badges */}
          {prCount > 0 && (
            <View style={styles.prList}>
              {data.new_prs!.map((pr, i) => (
                <View key={i} style={styles.prBadge}>
                  <Ionicons name="trophy" size={13} color={COLORS.recoveryMed} />
                  <Text style={styles.prText}>
                    {pr.exercise_name}: {pr.weight_kg}kg
                    {pr.delta_kg != null ? ` (+${pr.delta_kg}kg)` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Recovery tomorrow + Coach message */}
          <View style={styles.bottomRow}>
            {data.recovery_pct != null && (
              <View style={styles.recoveryBlock}>
                <RecoveryRing pct={data.recovery_pct} />
                <Text style={styles.recoveryLabel}>Recovery{'\n'}Tomorrow</Text>
              </View>
            )}
            {!!data.coach_message && (
              <View style={styles.coachBlock}>
                <Text style={styles.coachLabel}>COACH</Text>
                <Text style={styles.coachMessage}>{data.coach_message}</Text>
              </View>
            )}
          </View>

          {/* Best set (fallback detail if present) */}
          {data.best_set && (
            <View style={styles.bestSet}>
              <Text style={styles.bestSetLabel}>BEST SET</Text>
              <Text style={styles.bestSetValue}>
                {data.best_set.exercise}: {data.best_set.weight_kg}kg × {data.best_set.reps} reps
                {data.best_set.rpe ? ` (RPE ${data.best_set.rpe})` : ''}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onClose();
            }}
          >
            <Text style={styles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const recStyles = StyleSheet.create({
  pct: { position: 'absolute', fontSize: 13, fontWeight: '800' },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#1C1C1C', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 28, borderTopWidth: 1, borderColor: '#2A2A2A',
  },
  header: { alignItems: 'center', marginBottom: 24 },
  checkCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.primaryGreen,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  checkCirclePR: { backgroundColor: COLORS.recoveryMed },
  title: { color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#888', fontSize: 14, textAlign: 'center' },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around',
    backgroundColor: '#141414', borderRadius: 12, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: '#222',
  },
  stat: { alignItems: 'center', minWidth: '40%', marginBottom: 8 },
  statVal: { color: COLORS.primaryGreen, fontSize: 22, fontWeight: '800' },
  statLabel: { color: '#666', fontSize: 11, marginTop: 2 },

  prList: { gap: 6, marginBottom: 16 },
  prBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1A1606', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 1, borderColor: COLORS.recoveryMed + '40',
  },
  prText: { color: '#EFE6C0', fontSize: 12, fontWeight: '600', flex: 1 },

  bottomRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#141414', borderRadius: 12, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: '#222',
  },
  recoveryBlock: { alignItems: 'center', gap: 6 },
  recoveryLabel: { color: '#666', fontSize: 9, fontWeight: '700', textAlign: 'center', lineHeight: 12 },
  coachBlock: { flex: 1, gap: 4 },
  coachLabel: { color: '#555', fontSize: 9, fontWeight: '700', letterSpacing: 1.2 },
  coachMessage: { color: '#DDD', fontSize: 13, lineHeight: 19 },

  bestSet: {
    backgroundColor: '#141414', borderRadius: 10, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: '#222',
  },
  bestSetLabel: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  bestSetValue: { color: '#DDD', fontSize: 13, fontWeight: '600' },

  closeBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 4,
  },
  closeBtnText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
});