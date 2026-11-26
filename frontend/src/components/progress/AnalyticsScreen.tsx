// VYRN — Analytics
//
// Every visual is derived from the user's saved training records. The screen
// intentionally describes what the underlying data can prove: logged working
// sets, one primary-muscle classification per exercise, and saved PR entries.
// It does not present training distribution as hypertrophy or recovery proof.
// In embedded mode, ProgressScreen owns chart and range state across category switches.

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Svg, {
  Polygon, Circle as SvgCircle, Line as SvgLine, Text as SvgText,
} from 'react-native-svg';

import { analyticsApi, describeApiError } from '../../utils/api';
import AmbientGrid from '../shared/AmbientGrid';
import { COLORS, alpha } from '../../theme/colors';
import { qk, STALE } from '../../lib/queryKeys';
import { FONTS } from '../../theme/typography';

export type AnalyticsChartTab = 'heatmap' | 'radar' | 'prs';

interface HeatmapDay {
  date: string;
  sets: number;
  volume_kg: number;
  has_session: boolean;
  session_count?: number;
  future: boolean;
}
interface HeatmapResponse {
  weeks: HeatmapDay[][];
  total_sessions: number;
  has_data: boolean;
  empty_state?: string;
}
interface MuscleGroupStat { name: string; sets: number; pct: number; }
interface MuscleBalanceResponse {
  has_data: boolean;
  muscle_groups: MuscleGroupStat[];
  lower_exposure_groups?: string[];
  lagging?: string[];
  empty_state?: string;
  total_sets?: number;
  weeks?: number;
  comparison_basis?: string;
  lower_exposure_threshold_pct?: number;
}
interface PREntryResponse {
  date: string;
  lift: string;
  weight_kg: number;
  reps: number;
  is_pr: boolean;
}
interface PRTimelineResponse { has_data: boolean; prs: PREntryResponse[]; empty_state?: string; }

// Keep range values constrained to the windows supported by the analytics API.
export type AnalyticsRangeOption = 4 | 8 | 12;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const RANGE_OPTIONS: AnalyticsRangeOption[] = [4, 8, 12];

const CHART_TABS: { id: AnalyticsChartTab; label: string; caption: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'heatmap', label: 'Volume', caption: 'Training consistency', icon: 'grid-outline' },
  { id: 'radar', label: 'Muscle balance', caption: 'Primary-muscle exposure', icon: 'body-outline' },
  { id: 'prs', label: 'PR timeline', caption: 'Saved personal records', icon: 'trophy-outline' },
];

function EmptyState({ icon, title, text }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={22} color={COLORS.textMuted} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ChartLoadingState() {
  return (
    <View style={styles.loadingCard}>
      <ActivityIndicator color={COLORS.primaryGreen} />
      <Text style={styles.loadingText}>Preparing your training data…</Text>
    </View>
  );
}

function volumeColor(sets: number): string {
  if (sets <= 0) return COLORS.cardElevated;
  if (sets < 4) return alpha(COLORS.primaryGreen, 0.10);
  if (sets < 8) return alpha(COLORS.primaryGreen, 0.22);
  if (sets < 14) return alpha(COLORS.primaryGreen, 0.38);
  if (sets < 20) return alpha(COLORS.primaryGreen, 0.60);
  return COLORS.primaryGreen;
}

function VolumeHeatmap({ data, weeks }: { data: HeatmapResponse; weeks: number }) {
  const [tooltip, setTooltip] = useState<{ week: number; day: number; value: HeatmapDay } | null>(null);

  if (!data.has_data) {
    return (
      <EmptyState
        icon="calendar-outline"
        title="No completed sessions in this window"
        text={data.empty_state || 'Complete and save a workout. Your daily working-set activity will appear here.'}
      />
    );
  }

  const weekRows = Array.isArray(data.weeks) ? data.weeks : [];
  const selected = tooltip?.value;
  const selectedSessions = selected?.session_count ?? (selected?.has_session ? 1 : 0);

  return (
    <View>
      <View style={styles.heatmapDayRow}>
        {DAYS.map((day) => <Text key={day} style={styles.heatmapDayLabel}>{day}</Text>)}
      </View>
      {weekRows.map((week, weekIndex) => (
        <View key={'week-' + weekIndex} style={styles.heatmapWeekRow}>
          {DAYS.map((_, dayIndex) => {
            const day = week?.[dayIndex];
            if (!day) return <View key={'missing-' + dayIndex} style={[styles.heatmapCell, styles.heatmapMissing]} />;
            const selectedCell = tooltip?.week === weekIndex && tooltip?.day === dayIndex;
            const dayLabel = day.future
              ? day.date + ', future date'
              : day.date + ', ' + day.sets + ' working sets, ' +
                (day.session_count ?? (day.has_session ? 1 : 0)) + ' completed sessions';
            return (
              <TouchableOpacity
                key={day.date}
                style={[
                  styles.heatmapCell,
                  {
                    backgroundColor: day.future ? 'transparent' : volumeColor(day.sets),
                    borderColor: day.future ? 'transparent' : COLORS.border,
                    opacity: selectedCell ? 0.62 : 1,
                  },
                ]}
                onPress={() => { if (!day.future) setTooltip({ week: weekIndex, day: dayIndex, value: day }); }}
                disabled={day.future}
                accessibilityRole="button"
                accessibilityLabel={dayLabel}
                accessibilityState={{ selected: selectedCell, disabled: day.future }}
              />
            );
          })}
        </View>
      ))}

      {selected ? (
        <View style={styles.heatmapDetail}>
          <View style={styles.heatmapDetailHeader}>
            <Text style={styles.heatmapDetailDate}>{selected.date}</Text>
            <TouchableOpacity
              onPress={() => setTooltip(null)}
              accessibilityRole="button"
              accessibilityLabel="Close selected day details"
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={17} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.heatmapDetailMetrics}>
            <View style={styles.detailMetric}>
              <Text style={styles.detailMetricValue}>{selected.sets}</Text>
              <Text style={styles.detailMetricLabel}>WORKING SETS</Text>
            </View>
            <View style={styles.detailMetric}>
              <Text style={styles.detailMetricValue}>{selectedSessions}</Text>
              <Text style={styles.detailMetricLabel}>COMPLETED SESSIONS</Text>
            </View>
            <View style={styles.detailMetric}>
              <Text style={styles.detailMetricValue}>{Math.round(selected.volume_kg).toLocaleString()}</Text>
              <Text style={styles.detailMetricLabel}>LOGGED KG</Text>
            </View>
          </View>
        </View>
      ) : (
        <Text style={styles.tapHint}>Tap a day to inspect its logged training.</Text>
      )}

      <View style={styles.heatmapLegend}>
        <Text style={styles.legendLabel}>Less</Text>
        {[0, 1, 4, 8, 14, 20].map((value) => <View key={value} style={[styles.legendCell, { backgroundColor: volumeColor(value) }]} />)}
        <Text style={styles.legendLabel}>More</Text>
      </View>
      <Text style={styles.chartFootnote}>
        {data.total_sessions} completed session{data.total_sessions === 1 ? '' : 's'} across {weeks} calendar weeks
      </Text>
    </View>
  );
}

const RADAR_SIZE = 240;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = RADAR_SIZE * 0.34;

function radarXY(value: number, angle: number) {
  const distance = (Math.max(0, Math.min(100, value)) / 100) * RADAR_RADIUS;
  return { x: RADAR_CENTER + distance * Math.cos(angle), y: RADAR_CENTER + distance * Math.sin(angle) };
}

function RadarChart({ groups }: { groups: MuscleGroupStat[] }) {
  if (groups.length < 3) return null;
  const angles = groups.map((_, index) => (index * 2 * Math.PI) / groups.length - Math.PI / 2);
  const dataPoints = groups.map((group, index) => radarXY(group.pct, angles[index]));
  const polygonPoints = dataPoints.map((point) => point.x + ',' + point.y).join(' ');
  const levels = [25, 50, 75, 100];

  return (
    <Svg width={RADAR_SIZE} height={RADAR_SIZE} viewBox={'0 0 ' + RADAR_SIZE + ' ' + RADAR_SIZE}>
      {levels.map((level) => {
        const points = angles.map((angle) => {
          const point = radarXY(level, angle);
          return point.x + ',' + point.y;
        }).join(' ');
        return <Polygon key={level} points={points} fill="none" stroke={COLORS.border} strokeWidth={1} />;
      })}
      {angles.map((angle, index) => {
        const end = radarXY(100, angle);
        return <SvgLine key={'axis-' + index} x1={RADAR_CENTER} y1={RADAR_CENTER} x2={end.x} y2={end.y} stroke={COLORS.border} strokeWidth={1} />;
      })}
      <Polygon points={polygonPoints} fill={alpha(COLORS.primaryGreen, 0.13)} stroke={COLORS.primaryGreen} strokeWidth={2} />
      {dataPoints.map((point, index) => <SvgCircle key={'point-' + index} cx={point.x} cy={point.y} r={4} fill={COLORS.primaryGreen} />)}
      {groups.map((group, index) => {
        const labelRadius = RADAR_RADIUS + 25;
        const x = RADAR_CENTER + labelRadius * Math.cos(angles[index]);
        const y = RADAR_CENTER + labelRadius * Math.sin(angles[index]);
        return (
          <SvgText key={'label-' + group.name} x={x} y={y} textAnchor="middle" alignmentBaseline="middle" fontSize={9} fontWeight="600" fill={COLORS.textSecondary}>
            {group.name}
          </SvgText>
        );
      })}
    </Svg>
  );
}

function MuscleBalanceChart({ data, weeks }: { data: MuscleBalanceResponse; weeks: number }) {
  const groups = Array.isArray(data.muscle_groups) ? data.muscle_groups : [];
  const lowerExposure = data.lower_exposure_groups || data.lagging || [];
  const threshold = data.lower_exposure_threshold_pct ?? 40;

  if (!data.has_data || groups.length === 0) {
    return (
      <EmptyState
        icon="body-outline"
        title="Not enough classified training data"
        text={data.empty_state || 'Log working sets for exercises in the supported exercise catalogue to build this view.'}
      />
    );
  }

  const totalSets = data.total_sets ?? groups.reduce((sum, group) => sum + group.sets, 0);
  return (
    <View>
      <View style={styles.balanceSummary}>
        <View><Text style={styles.summaryValue}>{totalSets.toLocaleString()}</Text><Text style={styles.summaryLabel}>CLASSIFIED WORKING SETS</Text></View>
        <View style={styles.summaryDivider} />
        <View><Text style={styles.summaryValue}>{weeks}W</Text><Text style={styles.summaryLabel}>ROLLING WINDOW</Text></View>
      </View>

      {groups.length >= 3 ? (
        <View
          style={styles.radarWrap}
          accessible
          accessibilityLabel={'Primary muscle exposure compared with the most logged group. ' +
            groups.map((group) => group.name + ': ' + group.sets + ' sets, ' + group.pct + ' percent of peak').join('. ')}
        >
          <RadarChart groups={groups} />
        </View>
      ) : (
        <Text style={styles.chartFootnote}>The comparison chart needs at least three classified muscle groups.</Text>
      )}

      <View style={styles.muscleList}>
        {groups.map((group) => (
          <View key={group.name} style={styles.muscleRow}>
            <View style={styles.muscleRowTop}>
              <Text style={styles.muscleName}>{group.name}</Text>
              <Text style={styles.muscleCount}>{group.sets} set{group.sets === 1 ? '' : 's'} · {group.pct}% of peak</Text>
            </View>
            <View style={styles.muscleTrack}>
              <View style={[
                styles.muscleFill,
                { width: (Math.max(0, Math.min(100, group.pct)) + '%') as any, backgroundColor: group.pct < threshold ? COLORS.recoveryMed : COLORS.primaryGreen },
              ]} />
            </View>
          </View>
        ))}
      </View>

      {lowerExposure.length > 0 && (
        <View style={styles.insightBox}>
          <View style={styles.insightHeading}>
            <Ionicons name="information-circle-outline" size={15} color={COLORS.recoveryMed} />
            <Text style={styles.insightTitle}>LOWER LOGGED EXPOSURE</Text>
          </View>
          <Text style={styles.insightText}>
            {lowerExposure.join(', ')} are below {threshold}% of the most-logged primary-muscle group in this period.
            Each exercise is assigned one primary category here; secondary muscle work is not apportioned.
            This describes your log distribution, not muscle growth, recovery, or a recommendation to add sets.
          </Text>
        </View>
      )}

      <Text style={styles.chartFootnote}>
        Percentages compare classified working-set counts with the highest-count group (100%). Warm-up sets are excluded.
      </Text>
    </View>
  );
}

function PRTimeline({ prs }: { prs: PREntryResponse[] }) {
  if (!prs.length) {
    return <EmptyState icon="trophy-outline" title="No saved personal records yet" text="Log a qualifying personal record during a workout and it will appear here." />;
  }

  return (
    <View style={styles.timeline}>
      <View style={styles.timelineLine} />
      {prs.map((pr, index) => (
        <View key={pr.lift + '-' + pr.date + '-' + index} style={styles.timelineItem}>
          <View style={[styles.timelineDot, pr.is_pr && styles.timelineDotPR]}>
            {pr.is_pr && <Ionicons name="trophy" size={9} color={COLORS.background} />}
          </View>
          <View style={styles.timelineCard}>
            <View style={styles.timelineRow}>
              <View style={styles.timelineCopy}>
                <Text style={styles.timelineLift}>{pr.lift}</Text>
                <Text style={styles.timelineDate}>{pr.date}</Text>
              </View>
              <View style={styles.timelineNumbers}>
                <Text style={[styles.timelineWeight, pr.is_pr && styles.timelineWeightPR]}>
                  {Number(pr.weight_kg).toLocaleString()} <Text style={styles.timelineUnit}>kg</Text>
                </Text>
                <Text style={styles.timelineReps}>{pr.reps} rep{pr.reps === 1 ? '' : 's'}</Text>
                {pr.is_pr && <Text style={styles.prPill}>PERSONAL RECORD</Text>}
              </View>
            </View>
          </View>
        </View>
      ))}
      <Text style={styles.chartFootnote}>Saved PR entries only — not a point-by-point history of every working set.</Text>
    </View>
  );
}

function RangeSelector({ value, onChange }: { value: AnalyticsRangeOption; onChange: (next: AnalyticsRangeOption) => void }) {
  return (
    <View style={styles.rangeSelector} accessibilityRole="tablist">
      {RANGE_OPTIONS.map((range) => (
        <TouchableOpacity
          key={range}
          style={[styles.rangeOption, value === range && styles.rangeOptionActive]}
          onPress={() => onChange(range)}
          accessibilityRole="tab"
          accessibilityLabel={range + ' week range'}
          accessibilityState={{ selected: value === range }}
        >
          <Text style={[styles.rangeOptionText, value === range && styles.rangeOptionTextActive]}>{range}W</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function AnalyticsScreen({
  embedded = false,
  activeChart: controlledChart,
  onActiveChartChange,
  heatmapRange: controlledHeatmapWeeks,
  onHeatmapRangeChange,
  balanceRange: controlledBalanceWeeks,
  onBalanceRangeChange,
}: {
  embedded?: boolean;
  activeChart?: AnalyticsChartTab;
  onActiveChartChange?: (next: AnalyticsChartTab) => void;
  heatmapRange?: AnalyticsRangeOption;
  onHeatmapRangeChange?: (next: AnalyticsRangeOption) => void;
  balanceRange?: AnalyticsRangeOption;
  onBalanceRangeChange?: (next: AnalyticsRangeOption) => void;
}) {
  const [internalChart, setInternalChart] = useState<AnalyticsChartTab>('heatmap');
  const [internalHeatmapWeeks, setInternalHeatmapWeeks] = useState<AnalyticsRangeOption>(8);
  const [internalBalanceWeeks, setInternalBalanceWeeks] = useState<AnalyticsRangeOption>(4);
  const heatmapWeeks = controlledHeatmapWeeks ?? internalHeatmapWeeks;
  const balanceWeeks = controlledBalanceWeeks ?? internalBalanceWeeks;
  const setHeatmapWeeks = onHeatmapRangeChange ?? setInternalHeatmapWeeks;
  const setBalanceWeeks = onBalanceRangeChange ?? setInternalBalanceWeeks;
  const activeChart = controlledChart ?? internalChart;

  const selectChart = (next: AnalyticsChartTab) => {
    if (onActiveChartChange) onActiveChartChange(next);
    else setInternalChart(next);
  };

  const heatmapQuery = useQuery({
    queryKey: qk.analytics.heatmap(heatmapWeeks),
    queryFn: async () => (await analyticsApi.getHeatmap(heatmapWeeks)).data as HeatmapResponse,
    staleTime: STALE.medium,
    enabled: activeChart === 'heatmap',
  });
  const balanceQuery = useQuery({
    queryKey: qk.analytics.muscleBalance(balanceWeeks),
    queryFn: async () => (await analyticsApi.getMuscleBalance(balanceWeeks)).data as MuscleBalanceResponse,
    staleTime: STALE.medium,
    enabled: activeChart === 'radar',
  });
  const prTimelineQuery = useQuery({
    queryKey: qk.analytics.prTimeline(20),
    queryFn: async () => (await analyticsApi.getPRTimeline(20)).data as PRTimelineResponse,
    staleTime: STALE.long,
    enabled: activeChart === 'prs',
  });

  const currentQuery = activeChart === 'heatmap' ? heatmapQuery : activeChart === 'radar' ? balanceQuery : prTimelineQuery;
  const currentData = activeChart === 'heatmap' ? heatmapQuery.data : activeChart === 'radar' ? balanceQuery.data : prTimelineQuery.data;
  const errorMessage = currentQuery.error ? describeApiError(currentQuery.error).message : null;

  const content = (
    <View style={embedded ? styles.embeddedContent : styles.content}>
      {!embedded && (
        <>
          <Text style={styles.pageTitle}>Analytics</Text>
          <Text style={styles.pageSubtitle}>A clear read on the training you have actually logged.</Text>
        </>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chartTabsScroll} contentContainerStyle={styles.chartTabs} keyboardShouldPersistTaps="handled">
        {CHART_TABS.map((tab) => {
          const selected = activeChart === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.chartTab, selected && styles.chartTabActive]}
              onPress={() => selectChart(tab.id)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label + ': ' + tab.caption}
              accessibilityState={{ selected }}
            >
              <Ionicons name={tab.icon} size={15} color={selected ? COLORS.primaryGreen : COLORS.textMuted} />
              <Text style={[styles.chartTabText, selected && styles.chartTabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {activeChart === 'heatmap' && (
        <View style={styles.rangeRow}>
          <View><Text style={styles.rangeTitle}>TIME WINDOW</Text><Text style={styles.rangeDescription}>Completed-session activity</Text></View>
          <RangeSelector value={heatmapWeeks} onChange={setHeatmapWeeks} />
        </View>
      )}
      {activeChart === 'radar' && (
        <View style={styles.rangeRow}>
          <View><Text style={styles.rangeTitle}>TIME WINDOW</Text><Text style={styles.rangeDescription}>Primary-muscle set counts</Text></View>
          <RangeSelector value={balanceWeeks} onChange={setBalanceWeeks} />
        </View>
      )}

      {currentQuery.isPending && currentQuery.fetchStatus === 'fetching' && !currentData ? (
        <ChartLoadingState />
      ) : !currentData ? (
        <View style={styles.stateCard}>
          <EmptyState
            icon="cloud-offline-outline"
            title={currentQuery.fetchStatus === 'paused' ? 'Waiting for connection' : 'Analytics could not load'}
            text={errorMessage || 'The chart has no response yet. Check your connection and try again.'}
          />
          <TouchableOpacity style={styles.retryButton} onPress={() => { void currentQuery.refetch(); }} accessibilityRole="button" accessibilityLabel="Retry loading this analytics chart">
            <Ionicons name="refresh" size={14} color={COLORS.background} />
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.chartCard}>
          {activeChart === 'heatmap' && heatmapQuery.data && (
            <>
              <Text style={styles.cardEyebrow}>TRAINING FREQUENCY</Text>
              <Text style={styles.cardTitle}>Volume heatmap</Text>
              <Text style={styles.cardDescription}>Daily working-set logs and completed sessions. Brighter cells indicate more logged working sets.</Text>
              <VolumeHeatmap data={heatmapQuery.data} weeks={heatmapWeeks} />
            </>
          )}
          {activeChart === 'radar' && balanceQuery.data && (
            <>
              <Text style={styles.cardEyebrow}>PRIMARY MUSCLE EXPOSURE</Text>
              <Text style={styles.cardTitle}>Muscle distribution</Text>
              <Text style={styles.cardDescription}>Compares the number of classified working sets per primary muscle group.</Text>
              <MuscleBalanceChart data={balanceQuery.data} weeks={balanceWeeks} />
            </>
          )}
          {activeChart === 'prs' && prTimelineQuery.data && (
            <>
              <Text style={styles.cardEyebrow}>STRENGTH MILESTONES</Text>
              <Text style={styles.cardTitle}>Personal record history</Text>
              <Text style={styles.cardDescription}>Your latest saved personal-record entries, ordered by achievement date.</Text>
              <PRTimeline prs={prTimelineQuery.data.prs || []} />
            </>
          )}

          {currentQuery.isFetching && (
            <View style={styles.refreshingRow}><ActivityIndicator size="small" color={COLORS.primaryGreen} /><Text style={styles.refreshingText}>Updating this chart…</Text></View>
          )}
          {!!errorMessage && !!currentData && (
            <View style={styles.staleNotice}>
              <Ionicons name="cloud-offline-outline" size={14} color={COLORS.recoveryMed} />
              <Text style={styles.staleNoticeText}>Could not refresh. Showing the last saved result.</Text>
              <TouchableOpacity onPress={() => { void currentQuery.refetch(); }} accessibilityRole="button" accessibilityLabel="Retry chart refresh">
                <Text style={styles.retryInline}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );

  if (embedded) return content;
  return (
    <View style={styles.root}>
      <AmbientGrid />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>{content}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 40 },
  embeddedContent: { paddingBottom: 8 },
  pageTitle: { fontFamily: FONTS.bold, fontSize: 24, fontWeight: '700', color: COLORS.text, letterSpacing: -0.6, marginBottom: 4 },
  pageSubtitle: { fontFamily: FONTS.regular, fontSize: 13, color: COLORS.textSecondary, lineHeight: 19, marginBottom: 18 },

  chartTabsScroll: { marginBottom: 16, flexGrow: 0 },
  chartTabs: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8, paddingRight: 8 },
  chartTab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: COLORS.cardElevated },
  chartTabActive: { backgroundColor: alpha(COLORS.primaryGreen, 0.10), borderColor: alpha(COLORS.primaryGreen, 0.62) },
  chartTabText: { fontFamily: FONTS.semibold, color: COLORS.textSecondary, fontSize: 12 },
  chartTabTextActive: { color: COLORS.primaryGreen },

  rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  rangeTitle: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 10, letterSpacing: 1.1 },
  rangeDescription: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, marginTop: 3 },
  rangeSelector: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 3, gap: 2 },
  rangeOption: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  rangeOptionActive: { backgroundColor: COLORS.primaryGreen },
  rangeOptionText: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 10 },
  rangeOptionTextActive: { color: COLORS.background },

  chartCard: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 16 },
  cardEyebrow: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 1.35, marginBottom: 6 },
  cardTitle: { color: COLORS.text, fontFamily: FONTS.bold, fontSize: 17, fontWeight: '700', letterSpacing: -0.25 },
  cardDescription: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 11, lineHeight: 17, marginTop: 5, marginBottom: 15 },

  loadingCard: { minHeight: 170, alignItems: 'center', justifyContent: 'center', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card },
  loadingText: { color: COLORS.textMuted, fontSize: 12, fontFamily: FONTS.regular },
  stateCard: { borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, padding: 16 },
  emptyWrap: { alignItems: 'center', paddingVertical: 30, gap: 8 },
  emptyIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border, marginBottom: 2 },
  emptyTitle: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 13, textAlign: 'center' },
  emptyText: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 11, textAlign: 'center', paddingHorizontal: 10, lineHeight: 17 },
  retryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', gap: 7, backgroundColor: COLORS.primaryGreen, borderRadius: 10, paddingHorizontal: 17, paddingVertical: 10, marginBottom: 8 },
  retryButtonText: { color: COLORS.background, fontFamily: FONTS.bold, fontSize: 12 },

  heatmapDayRow: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  heatmapDayLabel: { flex: 1, textAlign: 'center', color: COLORS.textMuted, fontFamily: FONTS.semibold, fontSize: 8 },
  heatmapWeekRow: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  heatmapCell: { flex: 1, height: 19, borderRadius: 4, borderWidth: 1 },
  heatmapMissing: { backgroundColor: 'transparent', borderColor: 'transparent' },
  heatmapDetail: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.cardElevated, borderRadius: 11, padding: 11, marginTop: 12 },
  heatmapDetailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heatmapDetailDate: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 12 },
  heatmapDetailMetrics: { flexDirection: 'row', marginTop: 12, gap: 4 },
  detailMetric: { flex: 1 },
  detailMetricValue: { color: COLORS.primaryGreen, fontFamily: FONTS.numericBold, fontSize: 17 },
  detailMetricLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 7, letterSpacing: 0.55, marginTop: 2 },
  tapHint: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, textAlign: 'center', marginTop: 12 },
  heatmapLegend: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, marginTop: 17 },
  legendLabel: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 9, marginHorizontal: 2 },
  legendCell: { width: 11, height: 11, borderRadius: 3, borderWidth: 1, borderColor: COLORS.border },
  chartFootnote: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 12 },

  balanceSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingVertical: 12, marginBottom: 10 },
  summaryValue: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 19, textAlign: 'center' },
  summaryLabel: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 7, letterSpacing: 0.7, marginTop: 2, textAlign: 'center' },
  summaryDivider: { width: 1, height: 30, backgroundColor: COLORS.border },
  radarWrap: { alignItems: 'center', marginVertical: 4 },
  muscleList: { gap: 11, marginTop: 3 },
  muscleRow: { gap: 6 },
  muscleRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  muscleName: { color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 11 },
  muscleCount: { color: COLORS.text, fontFamily: FONTS.numeric, fontSize: 10 },
  muscleTrack: { height: 6, backgroundColor: COLORS.cardElevated, borderRadius: 4, overflow: 'hidden' },
  muscleFill: { height: '100%', borderRadius: 4 },
  insightBox: { backgroundColor: alpha(COLORS.recoveryMed, 0.07), borderRadius: 10, borderWidth: 1, borderColor: alpha(COLORS.recoveryMed, 0.22), padding: 11, marginTop: 15 },
  insightHeading: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  insightTitle: { color: COLORS.recoveryMed, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 1 },
  insightText: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 10, lineHeight: 16 },

  timeline: { paddingLeft: 20, position: 'relative' },
  timelineLine: { position: 'absolute', left: 7, top: 12, bottom: 30, width: 1, backgroundColor: COLORS.borderLight },
  timelineItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  timelineDot: { position: 'absolute', left: -19, top: 13, width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: COLORS.borderLight, backgroundColor: COLORS.cardElevated, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  timelineDotPR: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  timelineCard: { flex: 1, backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border, borderRadius: 11, padding: 12 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  timelineCopy: { flex: 1 },
  timelineLift: { color: COLORS.text, fontFamily: FONTS.semibold, fontSize: 12 },
  timelineDate: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, marginTop: 3 },
  timelineNumbers: { alignItems: 'flex-end' },
  timelineWeight: { color: COLORS.text, fontFamily: FONTS.numericBold, fontSize: 18 },
  timelineWeightPR: { color: COLORS.primaryGreen },
  timelineUnit: { color: COLORS.textMuted, fontFamily: FONTS.numeric, fontSize: 10 },
  timelineReps: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, marginTop: 1 },
  prPill: { color: COLORS.background, backgroundColor: COLORS.primaryGreen, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, overflow: 'hidden', fontFamily: FONTS.bold, fontSize: 7, letterSpacing: 0.6, marginTop: 5 },

  refreshingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 14, paddingTop: 12 },
  refreshingText: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10 },
  staleNotice: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: alpha(COLORS.recoveryMed, 0.08), borderRadius: 8, padding: 9, marginTop: 12 },
  staleNoticeText: { color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 9, flex: 1 },
  retryInline: { color: COLORS.primaryGreen, fontFamily: FONTS.bold, fontSize: 10 },
});
