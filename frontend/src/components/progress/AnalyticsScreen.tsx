// VYRN — Analytics Screen (Priority 4 + 6: Rich Charts)
// Three chart types: 8-week volume heatmap, muscle group radar with imbalance alerts,
// animated PR timeline. All data is real, pulled from /api/progress/heatmap,
// /api/progress/muscle-balance and /api/progress/pr-timeline — nothing here is
// generated or hardcoded. Each chart has its own empty state for new accounts.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Polygon, Circle as SvgCircle, Line as SvgLine,
  Text as SvgText,
} from 'react-native-svg';
import { analyticsApi, describeApiError } from '../../utils/api';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';

// ── Types (mirror backend responses exactly) ────────────────────────────────────
interface HeatmapDay { date: string; sets: number; volume_kg: number; has_session: boolean; future: boolean; }
interface HeatmapResponse { weeks: HeatmapDay[][]; total_sessions: number; has_data: boolean; }

interface MuscleGroupStat { name: string; sets: number; pct: number; }
interface MuscleBalanceResponse {
  has_data: boolean; muscle_groups: MuscleGroupStat[]; lagging?: string[];
  empty_state?: string; total_sets?: number; weeks?: number;
}

interface PREntryResponse { date: string; lift: string; weight_kg: number; reps: number; is_pr: boolean; }
interface PRTimelineResponse { has_data: boolean; prs: PREntryResponse[]; empty_state?: string; }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name={icon} size={28} color={COLORS.textMuted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

// ── Volume Heatmap ─────────────────────────────────────────────────────────────
function volumeColor(sets: number): string {
  if (sets === 0)  return '#0D0D0D';
  if (sets < 4)    return '#16EC0628';
  if (sets < 8)    return '#16EC0655';
  if (sets < 14)   return '#16EC0685';
  if (sets < 20)   return '#16EC06B8';
  return COLORS.recoveryHigh;
}

function VolumeHeatmap({ data }: { data: HeatmapResponse }) {
  const [tooltip, setTooltip] = useState<{ w: number; d: number; day: HeatmapDay } | null>(null);

  if (!data.has_data) {
    return <EmptyState icon="grid-outline" text="No workouts logged yet. Complete a session to start building your volume map." />;
  }

  return (
    <View>
      <View style={styles.hmDayRow}>
        {DAYS.map((d) => (
          <Text key={d} style={styles.hmDayLabel}>{d}</Text>
        ))}
      </View>
      {data.weeks.map((week, wi) => (
        <View key={wi} style={styles.hmWeekRow}>
          {week.map((day, di) => (
            <TouchableOpacity
              key={di}
              style={[
                styles.hmCell,
                {
                  backgroundColor: day.future ? 'transparent' : volumeColor(day.sets),
                  borderColor: day.future ? 'transparent' : '#ffffff08',
                  opacity: tooltip?.w === wi && tooltip?.d === di ? 0.7 : 1,
                },
              ]}
              onPress={() => !day.future && setTooltip({ w: wi, d: di, day })}
              disabled={day.future}
            />
          ))}
        </View>
      ))}
      {tooltip && (
        <Text style={styles.hmTooltip}>
          {tooltip.day.date} —{' '}
          <Text style={{ color: COLORS.recoveryHigh, fontFamily: FONTS.numericBold }}>
            {tooltip.day.sets}
          </Text>{' '}
          sets
          {tooltip.day.volume_kg > 0 && (
            <Text style={{ color: COLORS.textSecondary }}> · {tooltip.day.volume_kg} kg volume</Text>
          )}
        </Text>
      )}
      <View style={styles.hmLegend}>
        <Text style={styles.hmLegendLabel}>Less</Text>
        {[0, 4, 8, 14, 20, 26].map((v) => (
          <View key={v} style={[styles.hmLegendCell, { backgroundColor: volumeColor(v) }]} />
        ))}
        <Text style={styles.hmLegendLabel}>More</Text>
      </View>
      <Text style={styles.hmFootnote}>{data.total_sessions} session{data.total_sessions === 1 ? '' : 's'} logged in this window</Text>
    </View>
  );
}

// ── Radar Chart ────────────────────────────────────────────────────────────────
const RADAR_SIZE = 200;
const CR = RADAR_SIZE / 2;
const RR = RADAR_SIZE * 0.36;

function radarXY(val: number, angle: number) {
  const dist = (val / 100) * RR;
  return { x: CR + dist * Math.cos(angle), y: CR + dist * Math.sin(angle) };
}

function RadarChart({ groups }: { groups: MuscleGroupStat[] }) {
  const n = groups.length;
  const angles = groups.map((_, i) => (i * 2 * Math.PI) / n - Math.PI / 2);
  const dataPoints = groups.map((g, i) => radarXY(g.pct, angles[i]));
  const polyPts = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const GRID_LEVELS = [25, 50, 75, 100];

  return (
    <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
      {GRID_LEVELS.map((lvl) => {
        const pts = angles.map((a) => {
          const p = radarXY(lvl, a);
          return `${p.x},${p.y}`;
        }).join(' ');
        return <Polygon key={lvl} points={pts} fill="none" stroke="#1F1F1F" strokeWidth={1} />;
      })}
      {angles.map((angle, i) => {
        const end = radarXY(100, angle);
        return <SvgLine key={i} x1={CR} y1={CR} x2={end.x} y2={end.y} stroke="#1F1F1F" strokeWidth={1} />;
      })}
      <Polygon points={polyPts} fill="#16EC0618" stroke={COLORS.recoveryHigh} strokeWidth={1.5} />
      {dataPoints.map((p, i) => (
        <SvgCircle key={i} cx={p.x} cy={p.y} r={3} fill={COLORS.recoveryHigh} />
      ))}
      {groups.map((g, i) => {
        const lx = CR + (RR + 22) * Math.cos(angles[i]);
        const ly = CR + (RR + 22) * Math.sin(angles[i]);
        return (
          <SvgText key={i} x={lx} y={ly} textAnchor="middle" alignmentBaseline="middle" fontSize={9} fill={COLORS.textSecondary} fontWeight="600">
            {g.name}
          </SvgText>
        );
      })}
    </Svg>
  );
}

// ── PR Timeline ────────────────────────────────────────────────────────────────
function PRTimeline({ prs }: { prs: PREntryResponse[] }) {
  return (
    <View style={styles.tlContainer}>
      <View style={styles.tlLine} />
      {prs.map((pr, i) => (
        <View key={i} style={styles.tlItem}>
          <View
            style={[
              styles.tlDot,
              {
                backgroundColor: pr.is_pr ? COLORS.recoveryHigh : COLORS.border,
                borderColor:     pr.is_pr ? COLORS.recoveryHigh : '#2A2A2A',
                shadowColor:     pr.is_pr ? COLORS.recoveryHigh : 'transparent',
                shadowRadius:    pr.is_pr ? 6 : 0,
                shadowOpacity:   0.5,
                elevation:       0,
              },
            ]}
          >
            {pr.is_pr && <Text style={styles.tlStar}>★</Text>}
          </View>
          <View style={styles.tlCard}>
            <View style={styles.tlRow}>
              <View>
                <Text style={styles.tlLift}>{pr.lift}</Text>
                <Text style={styles.tlDate}>{pr.date}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.tlWeight, { color: pr.is_pr ? COLORS.recoveryHigh : COLORS.text }]}>
                  {pr.weight_kg}<Text style={styles.tlKg}> kg</Text>
                </Text>
                <Text style={styles.tlReps}>{pr.reps} rep{pr.reps === 1 ? '' : 's'}</Text>
                {pr.is_pr && (
                  <View style={styles.prBadge}>
                    <Text style={styles.prBadgeText}>PR</Text>
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
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [balance, setBalance] = useState<MuscleBalanceResponse | null>(null);
  const [prTimeline, setPrTimeline] = useState<PRTimelineResponse | null>(null);

  const loadData = useCallback(async () => {
    setErrorMsg(null);
    try {
      const [hRes, bRes, pRes] = await Promise.all([
        analyticsApi.getHeatmap(8),
        analyticsApi.getMuscleBalance(4),
        analyticsApi.getPRTimeline(20),
      ]);
      setHeatmap(hRes.data);
      setBalance(bRes.data);
      setPrTimeline(pRes.data);
    } catch (err: any) {
      const { message } = describeApiError(err);
      setErrorMsg(message);
    }
  }, []);

  useEffect(() => {
    (async () => { setLoading(true); await loadData(); setLoading(false); })();
  }, [loadData]);

  const lagging = balance?.lagging || [];

  const content = (
    <View style={embedded ? { paddingBottom: 40 } : styles.content}>
      {!embedded && <Text style={styles.title}>Analytics</Text>}
      {!embedded && <Text style={styles.subtitle}>Your real training data, visualized</Text>}

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

      {loading ? (
        <View style={styles.card}>
          <ActivityIndicator color={COLORS.recoveryHigh} />
        </View>
      ) : errorMsg ? (
        <View style={styles.card}>
          <EmptyState icon="cloud-offline-outline" text={errorMsg} />
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); loadData().finally(() => setLoading(false)); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {activeChart === 'heatmap' && heatmap && (
            <View style={styles.card}>
              <Text style={[styles.cardTitle, { color: COLORS.recoveryHigh }]}>
                Training Volume — 8 Weeks
              </Text>
              <VolumeHeatmap data={heatmap} />
            </View>
          )}

          {activeChart === 'radar' && balance && (
            <View style={styles.card}>
              <Text style={[styles.cardTitle, { color: COLORS.recoveryHigh }]}>
                Muscle Group Balance
              </Text>
              {!balance.has_data ? (
                <EmptyState icon="body-outline" text={balance.empty_state || 'Not enough data yet.'} />
              ) : (
                <>
                  <View style={styles.radarCenter}>
                    <RadarChart groups={balance.muscle_groups} />
                  </View>
                  <View style={styles.muscleGrid}>
                    {balance.muscle_groups.map((g) => (
                      <View key={g.name} style={styles.muscleCell}>
                        <Text style={styles.muscleLabel}>{g.name.toUpperCase()}</Text>
                        <Text
                          style={[
                            styles.muscleValue,
                            { color: g.pct < 40 ? COLORS.recoveryMed : COLORS.recoveryHigh },
                          ]}
                        >
                          {g.sets} set{g.sets === 1 ? '' : 's'}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {lagging.length > 0 && (
                    <View style={styles.alertBox}>
                      <Text style={styles.alertTitle}>BALANCE ALERT</Text>
                      <Text style={styles.alertText}>
                        {lagging.join(', ')} volume lagging relative to your other muscle groups. Add 2 sets per session for 3 weeks.
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          {activeChart === 'prs' && prTimeline && (
            <View style={styles.card}>
              <Text style={[styles.cardTitle, { color: COLORS.recoveryHigh }]}>
                Personal Record Timeline
              </Text>
              {!prTimeline.has_data ? (
                <EmptyState icon="trophy-outline" text={prTimeline.empty_state || 'No PRs logged yet.'} />
              ) : (
                <PRTimeline prs={prTimeline.prs} />
              )}
            </View>
          )}
        </>
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

  // Empty state
  emptyWrap: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 16, lineHeight: 19 },
  retryBtn: { marginTop: 4, alignSelf: 'center', backgroundColor: '#1A1A1A', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, borderWidth: 1, borderColor: '#2A2A2A' },
  retryText: { color: COLORS.recoveryHigh, fontSize: 13, fontWeight: '700' },

  // Heatmap
  hmDayRow: { flexDirection: 'row', gap: 3, marginBottom: 5 },
  hmDayLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONTS.bold,
    fontSize: 8,
    fontWeight: '600',
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  hmWeekRow: { flexDirection: 'row', gap: 3, marginBottom: 3 },
  hmCell: {
    flex: 1,
    height: 14,
    borderRadius: 2,
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
    gap: 4,
    marginTop: 14,
    paddingHorizontal: 8,
  },
  hmLegendLabel: {
    fontFamily: FONTS.regular,
    fontSize: 10,
    color: COLORS.textMuted,
    marginHorizontal: 2,
  },
  hmLegendCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#ffffff08',
  },
  hmFootnote: {
    fontFamily: FONTS.regular,
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 10,
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
    fontSize: 14,
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
  tlReps: {
    fontFamily: FONTS.regular,
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 1,
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
