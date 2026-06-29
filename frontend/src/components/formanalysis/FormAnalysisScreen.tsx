// VYRN — Form Analysis (Computer Vision mock)
// Priority 1: Animated pose skeleton cycles through squat phases,
// per-metric scores (bar path, depth, knee tracking, tempo),
// and a priority-fix callout for the knee cave.

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Animated,
} from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';

// ── Pose keypoints ─────────────────────────────────────────────────────────────
type PoseName = 'idle' | 'top' | 'descent' | 'bottom';
type KeypointName =
  | 'head' | 'lShoulder' | 'rShoulder'
  | 'lElbow' | 'rElbow' | 'lWrist' | 'rWrist'
  | 'hip' | 'lKnee' | 'rKnee' | 'lAnkle' | 'rAnkle';

type PoseKeypoints = Record<KeypointName, [number, number]>;

interface PoseFrame {
  points: PoseKeypoints;
  score: number;
  phase: string;
}

const POSES: Record<PoseName, PoseFrame> = {
  idle: {
    points: {
      head:      [50, 12], lShoulder: [36, 28], rShoulder: [64, 28],
      lElbow:    [26, 46], rElbow:    [74, 46], lWrist:    [22, 62], rWrist:    [78, 62],
      hip:       [50, 58], lKnee:     [38, 76], rKnee:     [62, 76], lAnkle:    [36, 92], rAnkle:    [64, 92],
    },
    score: 0,
    phase: 'Stand in frame to begin',
  },
  top: {
    points: {
      head:      [50, 12], lShoulder: [36, 26], rShoulder: [64, 26],
      lElbow:    [28, 44], rElbow:    [72, 44], lWrist:    [24, 60], rWrist:    [76, 60],
      hip:       [50, 56], lKnee:     [38, 74], rKnee:     [62, 74], lAnkle:    [36, 92], rAnkle:    [64, 92],
    },
    score: 91,
    phase: 'TOP — Good stance width',
  },
  descent: {
    points: {
      head:      [50, 18], lShoulder: [34, 34], rShoulder: [66, 34],
      lElbow:    [26, 50], rElbow:    [74, 50], lWrist:    [22, 64], rWrist:    [78, 64],
      hip:       [50, 64], lKnee:     [32, 80], rKnee:     [68, 80], lAnkle:    [34, 94], rAnkle:    [66, 94],
    },
    score: 88,
    phase: 'DESCENT — Maintain bar path',
  },
  bottom: {
    points: {
      head:      [50, 26], lShoulder: [33, 40], rShoulder: [67, 40],
      lElbow:    [22, 54], rElbow:    [78, 54], lWrist:    [18, 66], rWrist:    [82, 66],
      hip:       [50, 72], lKnee:     [28, 86], rKnee:     [72, 86], lAnkle:    [32, 96], rAnkle:    [68, 96],
    },
    score: 85,
    phase: 'BOTTOM — Slight knee cave detected',
  },
};

const CONNECTIONS: [KeypointName, KeypointName][] = [
  ['head', 'lShoulder'], ['head', 'rShoulder'], ['lShoulder', 'rShoulder'],
  ['lShoulder', 'lElbow'], ['rShoulder', 'rElbow'],
  ['lElbow', 'lWrist'], ['rElbow', 'rWrist'],
  ['lShoulder', 'hip'], ['rShoulder', 'hip'],
  ['hip', 'lKnee'], ['hip', 'rKnee'],
  ['lKnee', 'lAnkle'], ['rKnee', 'rAnkle'],
];

const PHASE_ORDER: PoseName[] = ['idle', 'top', 'descent', 'bottom'];

// ── Form metrics ───────────────────────────────────────────────────────────────
const METRICS = [
  { label: 'Bar Path',      score: 94, status: 'good', note: 'Consistent vertical tracking' },
  { label: 'Hip Depth',     score: 91, status: 'good', note: 'Parallel achieved on all reps' },
  { label: 'Knee Tracking', score: 79, status: 'warn', note: 'Left knee caves at bottom (valgus)' },
  { label: 'Torso Angle',   score: 88, status: 'good', note: 'Slight forward lean — acceptable' },
  { label: 'Tempo',         score: 85, status: 'good', note: 'Eccentric slightly fast (0.9 s avg)' },
];

// ── Skeleton canvas ───────────────────────────────────────────────────────────
const W = 200, H = 240;
function toX(px: number) { return (px / 100) * W; }
function toY(py: number) { return (py / 100) * H; }

function PoseCanvas({ pose, phase }: { pose: PoseFrame; phase: PoseName }) {
  const pts = pose.points;
  return (
    <Svg width={W} height={H}>
      {CONNECTIONS.map(([a, b], i) => (
        <Line
          key={i}
          x1={toX(pts[a][0])} y1={toY(pts[a][1])}
          x2={toX(pts[b][0])} y2={toY(pts[b][1])}
          stroke={COLORS.strain}
          strokeWidth={1.5}
          strokeOpacity={0.65}
        />
      ))}
      {(Object.entries(pts) as [KeypointName, [number, number]][]).map(([key, pt]) => {
        const isWarning = key === 'lKnee' && phase === 'bottom';
        const fill = isWarning ? COLORS.recoveryLow : COLORS.recoveryHigh;
        return (
          <Circle
            key={key}
            cx={toX(pt[0])} cy={toY(pt[1])}
            r={4}
            fill={fill}
          />
        );
      })}
    </Svg>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function FormAnalysisScreen() {
  const [phase, setPhase]           = useState<PoseName>('idle');
  const [analyzing, setAnalyzing]   = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const scanAnim                    = useRef(new Animated.Value(0)).current;

  const pose = POSES[phase];
  const scoreColor =
    pose.score >= 90 ? COLORS.recoveryHigh :
    pose.score >= 80 ? COLORS.recoveryMed  :
    pose.score >= 1  ? COLORS.recoveryLow  : COLORS.textMuted;

  const startScan = () => {
    Animated.loop(
      Animated.timing(scanAnim, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      })
    ).start();
  };

  const analyze = async () => {
    setAnalyzing(true);
    setShowFeedback(false);
    startScan();
    for (const p of PHASE_ORDER) {
      setPhase(p);
      await new Promise((r) => setTimeout(r, 650));
    }
    scanAnim.stopAnimation();
    setShowFeedback(true);
    setAnalyzing(false);
  };

  const scanY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, H],
  });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Form Analysis</Text>
      <Text style={styles.subtitle}>Computer vision · Squat session</Text>

      {/* Pose canvas card */}
      <View style={styles.poseCard}>
        <View style={styles.poseHeader}>
          <Text style={styles.sectionLabel}>Live Pose Detection</Text>
          {pose.score > 0 && (
            <Text style={[styles.poseScore, { color: scoreColor }]}>{pose.score}%</Text>
          )}
        </View>

        <View style={styles.canvasContainer}>
          {/* Idle placeholder */}
          {phase === 'idle' && !analyzing && (
            <View style={styles.idlePlaceholder}>
              <Ionicons name="body-outline" size={48} color="#444" style={{ marginBottom: 8 }} />
              <Text style={styles.idleText}>
                Tap Analyze to simulate form detection
              </Text>
            </View>
          )}

          {/* Skeleton */}
          {phase !== 'idle' && (
            <PoseCanvas pose={pose} phase={phase} />
          )}

          {/* Scan line overlay */}
          {analyzing && (
            <Animated.View
              style={[
                styles.scanLine,
                { transform: [{ translateY: scanY }] },
              ]}
            />
          )}

          {/* Phase label */}
          <View style={styles.phaseBadge}>
            <Text style={styles.phaseText}>{pose.phase}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.analyzeBtn, analyzing && styles.analyzeBtnDisabled]}
          onPress={analyze}
          disabled={analyzing}
        >
          <Text style={styles.analyzeBtnText}>
            {analyzing ? 'Analyzing…' : '▶  Analyze Set'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Feedback */}
      {showFeedback && (
        <View style={styles.feedbackCard}>
          <View style={styles.feedbackHeader}>
            <Text style={[styles.sectionLabel, { color: COLORS.recoveryHigh }]}>
              Form Analysis — Squat
            </Text>
            <Text style={styles.overallScore}>88%</Text>
          </View>

          {METRICS.map((item, i) => (
            <View key={i} style={styles.metricRow}>
              <View style={styles.metricMeta}>
                <Text style={styles.metricLabel}>{item.label}</Text>
                <Text
                  style={[
                    styles.metricScore,
                    { color: item.status === 'warn' ? COLORS.recoveryMed : COLORS.recoveryHigh },
                  ]}
                >
                  {item.score}%
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${item.score}%`,
                      backgroundColor:
                        item.status === 'warn' ? COLORS.recoveryMed : COLORS.recoveryHigh,
                    },
                  ]}
                />
              </View>
              <Text style={styles.metricNote}>{item.note}</Text>
            </View>
          ))}

          {/* Priority fix */}
          <View style={styles.fixBox}>
            <Text style={[styles.sectionLabel, { color: COLORS.recoveryMed }]}>PRIORITY FIX</Text>
            <Text style={styles.fixText}>
              Your hips rise before your chest at the bottom position.
              Focus: drive knees out cue + box squat variation to reinforce depth.
            </Text>
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
    fontFamily: FONTS.bold,
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  sectionLabel: {
    fontFamily: FONTS.bold,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.3,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
  },

  // Pose card
  poseCard: {
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14,
  },
  poseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  poseScore: {
    fontFamily: FONTS.numericBold,
    fontSize: 22,
    fontWeight: '800',
  },
  canvasContainer: {
    width: W,
    height: H,
    alignSelf: 'center',
    backgroundColor: '#050505',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    overflow: 'hidden',
    marginBottom: 12,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  idlePlaceholder: {
    alignItems: 'center',
    gap: 8,
  },
  idleIcon:  { fontSize: 36, opacity: 0.4 },
  idleText:  {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    maxWidth: 140,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: COLORS.strainGlow,
    opacity: 0.7,
  },
  phaseBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  phaseText: {
    fontFamily: FONTS.bold,
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  analyzeBtn: {
    backgroundColor: COLORS.recoveryHigh,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  analyzeBtnDisabled: { opacity: 0.5 },
  analyzeBtnText: {
    fontFamily: FONTS.bold,
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 0.5,
  },

  // Feedback card
  feedbackCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#16EC0630',
    padding: 14,
  },
  feedbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  overallScore: {
    fontFamily: FONTS.numericBold,
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.recoveryHigh,
  },

  // Metrics
  metricRow:   { marginBottom: 12 },
  metricMeta:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  metricLabel: {
    fontFamily: FONTS.medium,
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  metricScore: {
    fontFamily: FONTS.numericMedium,
    fontSize: 12,
    fontWeight: '600',
  },
  barTrack: {
    height: 3,
    backgroundColor: '#1F1F1F',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
  },
  metricNote: {
    fontFamily: FONTS.regular,
    fontSize: 10,
    color: COLORS.textMuted,
  },

  // Fix box
  fixBox: {
    backgroundColor: '#FFDE0010',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFDE0030',
    padding: 10,
    marginTop: 6,
  },
  fixText: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
    marginTop: 6,
  },
});