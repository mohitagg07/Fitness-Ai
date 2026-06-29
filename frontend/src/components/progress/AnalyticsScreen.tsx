// VYRN — Analytics Screen (Priority 4 + 6: Rich Charts)
// Three chart types: 8-week volume heatmap, muscle group radar with imbalance alerts,
// animated PR timeline. Integrated as a new tab distinct from the original Progress screen.

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
} from 'react-native';
import Svg, {
  Polygon, Circle as SvgCircle, Line as SvgLine,
  Text as SvgText,
} from 'react-native-svg';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';

// ── Volume Heatmap ─────────────────────────────────────────────────────────────
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKS = 8;

function volumeColor(v: number): string {
  if (v === 0)  return '#0D0D0D';
  if (v < 20)   return '#16EC0622';
  if (v < 40)   return '#16EC0650';
  if (v < 60)   return '#16EC0680';
  if (v < 80)   return '#16EC06BB';
  return COLORS.recoveryHigh;
}

function generateHeatmap(): number[][] {
  return Array.from({ length: WEEKS }, (_, w) =>
    DAYS.map((_, d) => {
      if (w === WEEKS - 1 && d > 1) return -1;
      if (Math.random() < 0.12) return 0;
      return Math.floor(Math.random() * 100);
    }),
  );
}
const HEATMAP = generateHeatmap();

function VolumeHeatmap() {
  const [tooltip, setTooltip] = useState<{ w: number; d: number; v: number } | null>(null);
  return (
    <View>
      {/* Day labels */}
      <View style={styles.hmDayRow}>
        {DAYS.map((d) => (
          <Text key={d} style={styles.hmDayLabel}>{d}</Text>
        ))}
      </View>
      {/* Grid */}
      {HEATMAP.map((week, wi) => (
        <View key={wi} style={styles.hmWeekRow}>
          {week.map((v, di) => (
            <TouchableOpacity
              key={di}
              style={[
                styles.hmCell,
                {
                  backgroundColor: v < 0 ? 'transparent' : volumeColor(v),
                  borderColor: v >= 0 ? '#ffffff08' : 'transparent',
                  opacity: tooltip?.w === wi && tooltip?.d === di ? 0.7 : 1,
                },
              ]}
              onPress={() => v >= 0 && setTooltip({ w: wi, d: di, v })}
              disabled={v < 0}
            />
          ))}
        </View>
      ))}
      {/* Tooltip */}
      {tooltip && (
        <Text style={styles.hmTooltip}>
          W{tooltip.w + 1} {DAYS[tooltip.d]} —{' '}
          <Text style={{ color: COLORS.recoveryHigh, fontFamily: FONTS.numericBold }}>
            {tooltip.v}
          </Text>{' '}
          sets
        </Text>
      )}
      {/* Legend */}
      <View style={styles.hmLegend}>
        <Text style={styles.hmLegendLabel}>Less</Text>
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <View
            key={v}
            style={[styles.hmLegendCell, { backgroundColor: volumeColor(v) }]}
          />
        ))}
        <Text style={styles.hmLegendLabel}>More</Text>
      </View>
    </View>
  );
}

// ── Radar Chart ────────────────────────────────────────────────────────────────
const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Legs'];
const MUSCLE_DATA   = [72, 85, 60, 68, 45, 90];
const RADAR_SIZE    = 200;
const CR            = RADAR_SIZE / 2;
const RR            = RADAR_SIZE * 0.36;
const N             = MUSCLE_GROUPS.length;
const ANGLES        = MUSCLE_GROUPS.map((_, i) => (i * 2 * Math.PI) / N - Math.PI / 2);

function radarXY(val: number, angle: number, scale = 1) {
  const dist = (val / 100) * RR * scale;
  return { x: CR + dist * Math.cos(angle), y: CR + dist * Math.sin(angle) };
}

function RadarChart() {
  const dataPoints = MUSCLE_DATA.map((v, i) => radarXY(v, ANGLES[i]));
  const polyPts = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const GRID_LEVELS = [25, 50, 75, 100];

  return (
    <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
      {/* Grid polygons */}
      {GRID_LEVELS.map((lvl) => {
        const pts = ANGLES.map((a) => {
          const p = radarXY(lvl, a);
          return `${p.x},${p.y}`;
        }).join(' ');
        return (
          <Polygon
            key={lvl}
            points={pts}
            fill="none"
            stroke="#1F1F1F"
            strokeWidth={1}
          />
        );
      })}
      {/* Axis lines */}
      {ANGLES.map((angle, i) => {
        const end = radarXY(100, angle);
        return (
          <SvgLine key={i} x1={CR} y1={CR} x2={end.x} y2={end.y} stroke="#1F1F1F" strokeWidth={1} />
        );
      })}
      {/* Data polygon */}
      <Polygon
        points={polyPts}
        fill="#16EC0618"
        stroke={COLORS.recoveryHigh}
        strokeWidth={1.5}
      />
      {/* Data dots */}
      {dataPoints.map((p, i) => (
        <SvgCircle key={i} cx={p.x} cy={p.y} r={3} fill={COLORS.recoveryHigh} />
      ))}
      {/* Labels */}
      {MUSCLE_GROUPS.map((lbl, i) => {
        const lp = radarXY(100, ANGLES[i]);
        const lx = CR + (RR + 22) * Math.cos(ANGLES[i]);
        const ly = CR + (RR + 22) * Math.sin(ANGLES[i]);
        return (
          <SvgText
            key={i}
            x={lx}
            y={ly}
            textAnchor="middle"
            alignmentBaseline="middle"
            fontSize={9}
            fill={COLORS.textSecondary}
            fontWeight="600"
          >
            {lbl}
          </SvgText>
        );
      })}
    </Svg>
  );
}

// ── PR Timeline ────────────────────────────────────────────────────────────────
interface PREntry {
  date: string;
  lift: string;
  weight: number;
  isPR: boolean;
}

const PR_DATA: PREntry[] = [
  { date: 'Jan 6',  lift: 'Deadlift',   weight: 185,   isPR: false },
  { date: 'Jan 20', lift: 'Deadlift',   weight: 192.5, isPR: true  },
  { date: 'Feb 3',  lift: 'Squat',      weight: 140,   isPR: false },
  { date: 'Feb 17', lift: 'Deadlift',   weight: 200,   isPR: true  },
  { date: 'Mar 3',  lift: 'Bench Press',weight: 100,   isPR: true  },
  { date: 'Mar 24', lift: 'Squat',      weight: 152.5, isPR: true  },
  { date: 'Apr 7',  lift: 'Deadlift',   weight: 210,   isPR: true  },
  { date: 'May 5',  lift: 'Bench Press',weight: 107.5, isPR: true  },
  { date: 'Jun 2',  lift: 'Squat',      weight: 162.5, isPR: true  },
  { date: 'Jun 16', lift: 'Deadlift',   weight: 220,   isPR: true  },
];

function PRTimeline() {
  return (
    <View style={styles.tlContainer}>
      <View style={styles.tlLine} />
      {[...PR_DATA].reverse().map((pr, i) => (
        <View key={i} style={styles.tlItem}>
          {/* Dot */}
          <View
            style={[
              styles.tlDot,
              {
                backgroundColor: pr.isPR ? COLORS.recoveryHigh : COLORS.border,
                borderColor:     pr.isPR ? COLORS.recoveryHigh : '#2A2A2A',
                shadowColor:     pr.isPR ? COLORS.recoveryHigh : 'transparent',
                shadowRadius:    pr.isPR ? 6 : 0,
                shadowOpacity:   0.5,
                elevation:       0,
              },
            ]}
          >
            {pr.isPR && <Text style={styles.tlStar}>★</Text>}
          </View>

          {/* Card */}
          <View style={styles.tlCard}>
            <View style={styles.tlRow}>
              <View>
                <Text style={styles.tlLift}>{pr.lift}</Text>
                <Text style={styles.tlDate}>{pr.date}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.tlWeight, { color: pr.isPR ? COLORS.recoveryHigh : COLORS.text }]}>
                  {pr.weight}<Text style={styles.tlKg}> kg</Text>
                </Text>
                {pr.isPR && (
                  <View style={styles.prBadge}>
                    <Text style={styles.prBadgeText}>NEW PR</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Analytics Screen ───────────────────────────────────────────────────────────
type ChartTab = 'heatmap' | 'radar' | 'prs';

const CHART_TABS: { id: ChartTab; label: string }[] = [
  { id: 'heatmap', label: 'Volume' },
  { id: 'radar',   label: 'Muscle Balance' },
  { id: 'prs',     label: 'PR Timeline' },
];

export default function AnalyticsScreen({ embedded = false }: { embedded?: boolean }) {
  const [activeChart, setActiveChart] = useState<ChartTab>('heatmap');
  const lagging = MUSCLE_GROUPS.filter((_, i) => MUSCLE_DATA[i] < 60);

  const content = (
    <View style={embedded ? { paddingBottom: 40 } : styles.content}>
      {!embedded && <Text style={styles.title}>Analytics</Text>}
      {!embedded && <Text style={styles.subtitle}>Rich training data, visualized</Text>}

      {/* Chart picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow}>
        {CHART_TABS.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tabBtn, activeChart === t.id && styles.tabBtnActive]}
            onPress={() => setActiveChart(t.id)}
          >
            <Text style={[styles.tabBtnText, activeChart === t.id && { color: COLORS.recoveryHigh }]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      {activeChart === 'heatmap' && (
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: COLORS.recoveryHigh }]}>
            Training Volume — 8 Weeks
          </Text>
          <VolumeHeatmap />
        </View>
      )}

      {activeChart === 'radar' && (
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: COLORS.recoveryHigh }]}>
            Muscle Group Balance
          </Text>
          <View style={styles.radarCenter}>
            <RadarChart />
          </View>
          <View style={styles.muscleGrid}>
            {MUSCLE_GROUPS.map((g, i) => (
              <View key={g} style={styles.muscleCell}>
                <Text style={styles.muscleLabel}>{g.toUpperCase()}</Text>
                <Text
                  style={[
                    styles.muscleValue,
                    { color: MUSCLE_DATA[i] < 60 ? COLORS.recoveryMed : COLORS.recoveryHigh },
                  ]}
                >
                  {MUSCLE_DATA[i]}%
                </Text>
              </View>
            ))}
          </View>
          {lagging.length > 0 && (
            <View style={styles.alertBox}>
              <Text style={styles.alertTitle}>BALANCE ALERT</Text>
              <Text style={styles.alertText}>
                {lagging.join(', ')} volume lagging. Add 2 sets per session for 3 weeks.
              </Text>
            </View>
          )}
        </View>
      )}

      {activeChart === 'prs' && (
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { color: COLORS.recoveryHigh }]}>
            Personal Record Timeline
          </Text>
          <PRTimeline />
        </View>
      )}
    </View>
  );

  if (embedded) return content;
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {content}
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

  // Tabs
  tabRow: { marginBottom: 16 },
  tabBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: COLORS.cardElevated,
  },
  tabBtnActive: {
    borderColor: COLORS.recoveryHigh,
    backgroundColor: '#16EC0610',
  },
  tabBtnText: {
    fontFamily: FONTS.semibold,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },

  // Card
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  cardTitle: {
    fontFamily: FONTS.bold,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 14,
  },

  // Heatmap
  hmDayRow: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  hmDayLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONTS.bold,
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  hmWeekRow: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  hmCell: {
    flex: 1,
    height: 18,
    borderRadius: 3,
    borderWidth: 1,
  },
  hmTooltip: {
    marginTop: 8,
    textAlign: 'center',
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  hmLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  hmLegendLabel: {
    fontFamily: FONTS.regular,
    fontSize: 10,
    color: COLORS.textMuted,
  },
  hmLegendCell: {
    width: 12,
    height: 12,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#ffffff08',
  },

  // Radar
  radarCenter: { alignItems: 'center', marginBottom: 14 },
  muscleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  muscleCell: {
    width: '30%',
    backgroundColor: COLORS.cardElevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 8,
    alignItems: 'center',
  },
  muscleLabel: {
    fontFamily: FONTS.bold,
    fontSize: 8,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  muscleValue: {
    fontFamily: FONTS.numericBold,
    fontSize: 16,
    fontWeight: '700',
  },
  alertBox: {
    backgroundColor: '#FFDE0010',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFDE0030',
    padding: 10,
  },
  alertTitle: {
    fontFamily: FONTS.bold,
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.recoveryMed,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  alertText: {
    fontFamily: FONTS.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  // PR Timeline
  tlContainer: { paddingLeft: 28, position: 'relative' },
  tlLine: {
    position: 'absolute',
    left: 19,
    top: 16,
    bottom: 0,
    width: 1,
    backgroundColor: '#2A2A2A',
  },
  tlItem: { flexDirection: 'row', marginBottom: 14, alignItems: 'flex-start' },
  tlDot: {
    position: 'absolute',
    left: -28,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    top: 8,
  },
  tlStar: { fontSize: 7, color: '#000', fontWeight: '900' },
  tlCard: {
    flex: 1,
    backgroundColor: COLORS.cardElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 10,
  },
  tlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tlLift: {
    fontFamily: FONTS.semibold,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  tlDate: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  tlWeight: {
    fontFamily: FONTS.numericBold,
    fontSize: 17,
    fontWeight: '700',
  },
  tlKg: {
    fontFamily: FONTS.regular,
    fontSize: 10,
    color: COLORS.textMuted,
  },
  prBadge: {
    backgroundColor: '#16EC0618',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#16EC0630',
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  prBadgeText: {
    fontFamily: FONTS.bold,
    fontSize: 8,
    fontWeight: '700',
    color: COLORS.recoveryHigh,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});