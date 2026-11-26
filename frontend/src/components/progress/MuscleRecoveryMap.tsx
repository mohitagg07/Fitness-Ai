// VYRN — Interactive Muscle Recovery Explorer
//
// The map is driven by persisted exercise logs. Recovery percentages are
// explicitly presented as time-based estimates; sets, tonnage, exercises,
// and last-trained timestamps are descriptive data from the user's logs.

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import api from '../../utils/api';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import { qk, STALE } from '../../lib/queryKeys';
import Text from '../ui/Text';
import SectionLabel from '../ui/SectionLabel';

type MuscleName = 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Core' | 'Legs';
type RecoveryStatus = 'green' | 'yellow' | 'red' | 'no_data';
type AnatomyView = 'front' | 'back';

interface MuscleGroupRecovery {
  name: MuscleName;
  recovery_pct: number | null;
  hours_since_trained: number | null;
  status: RecoveryStatus;
  volume_7d_kg: number;
  working_sets_7d: number;
  exercises_7d: string[];
  last_trained_at: string | null;
}

interface MuscleRecoveryResponse {
  muscle_groups: MuscleGroupRecovery[];
  has_data: boolean;
  model_note?: string;
}

const MUSCLE_ORDER: MuscleName[] = [
  'Chest',
  'Back',
  'Shoulders',
  'Arms',
  'Core',
  'Legs',
];

const STATUS_COLOR: Record<RecoveryStatus, string> = {
  green: COLORS.recoveryHigh,
  yellow: COLORS.recoveryMed,
  red: COLORS.recoveryLow,
  no_data: COLORS.textMuted,
};

const STATUS_LABEL: Record<RecoveryStatus, string> = {
  green: 'Ready',
  yellow: 'Recovering',
  red: 'Recently trained',
  no_data: 'No recent data',
};

function formatElapsed(hours: number | null): string {
  if (hours === null) return 'Not recorded';
  if (hours < 1) return 'Less than 1 hour ago';
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)} days ago`;
}

function formatVolume(volume: number): string {
  return `${Math.round(volume).toLocaleString()} kg`;
}

function MuscleRegion({
  color,
  selected,
  onPress,
  children,
}: {
  color: string;
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <G
      fill={color}
      stroke={selected ? COLORS.text : alpha(COLORS.text, 0.28)}
      strokeWidth={selected ? 2.6 : 1}
      opacity={selected ? 1 : 0.9}
      onPress={onPress}
    >
      {children}
    </G>
  );
}

function AnatomyFigure({
  view,
  selected,
  colorFor,
  onSelect,
}: {
  view: AnatomyView;
  selected: MuscleName;
  colorFor: (name: MuscleName) => string;
  onSelect: (name: MuscleName) => void;
}) {
  const front = view === 'front';

  return (
    <Svg viewBox="0 0 220 390" width={196} height={348}>
      {/* Neutral body outline and head. */}
      <Circle cx="110" cy="27" r="19" fill={COLORS.cardElevated} stroke={COLORS.borderLight} strokeWidth="1" />
      <Path
        d="M98 47 L122 47 L126 64 Q145 65 158 82 L176 129 Q180 143 169 148 L159 143 L147 111 L144 174 Q141 194 137 211 L146 337 Q148 350 135 352 L122 350 L111 234 L108 234 L97 350 L84 352 Q71 350 74 337 L83 211 Q79 194 76 174 L73 111 L61 143 L51 148 Q40 143 44 129 L62 82 Q75 65 94 64 Z"
        fill={COLORS.cardElevated}
        stroke={COLORS.borderLight}
        strokeWidth="1"
      />

      <MuscleRegion
        color={colorFor('Arms')}
        selected={selected === 'Arms'}
        onPress={() => onSelect('Arms')}
      >
        <Path d="M62 82 Q49 113 47 145 L54 169 Q63 166 66 151 L76 101 Z" />
        <Path d="M158 82 Q171 113 173 145 L166 169 Q157 166 154 151 L144 101 Z" />
      </MuscleRegion>

      <MuscleRegion
        color={colorFor('Shoulders')}
        selected={selected === 'Shoulders'}
        onPress={() => onSelect('Shoulders')}
      >
        <Ellipse cx="76" cy="78" rx="20" ry="17" />
        <Ellipse cx="144" cy="78" rx="20" ry="17" />
      </MuscleRegion>

      {front ? (
        <>
          <MuscleRegion
            color={colorFor('Chest')}
            selected={selected === 'Chest'}
            onPress={() => onSelect('Chest')}
          >
            <Path d="M81 91 Q110 79 139 91 L137 139 Q110 150 83 139 Z" />
          </MuscleRegion>
          <MuscleRegion
            color={colorFor('Core')}
            selected={selected === 'Core'}
            onPress={() => onSelect('Core')}
          >
            <Path d="M84 143 Q110 151 136 143 L132 203 Q110 212 88 203 Z" />
          </MuscleRegion>
        </>
      ) : (
        <>
          <MuscleRegion
            color={colorFor('Back')}
            selected={selected === 'Back'}
            onPress={() => onSelect('Back')}
          >
            <Path d="M80 91 Q110 80 140 91 L143 153 Q132 169 110 177 Q88 169 77 153 Z" />
            <Path d="M87 178 Q110 185 133 178 L129 205 Q110 213 91 205 Z" />
          </MuscleRegion>
          <MuscleRegion
            color={colorFor('Core')}
            selected={selected === 'Core'}
            onPress={() => onSelect('Core')}
          >
            <Path d="M91 207 Q110 214 129 207 L125 227 L95 227 Z" />
          </MuscleRegion>
        </>
      )}

      <MuscleRegion
        color={colorFor('Legs')}
        selected={selected === 'Legs'}
        onPress={() => onSelect('Legs')}
      >
        <Path d="M86 214 Q99 218 107 218 L101 313 L91 340 L76 337 L80 263 Z" />
        <Path d="M114 218 Q122 218 134 214 L140 263 L144 337 L129 340 L119 313 Z" />
      </MuscleRegion>

      <Ellipse cx="84" cy="352" rx="13" ry="7" fill={COLORS.cardElevated} />
      <Ellipse cx="136" cy="352" rx="13" ry="7" fill={COLORS.cardElevated} />
    </Svg>
  );
}

export default function MuscleRecoveryMap() {
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleName>('Chest');
  const [view, setView] = useState<AnatomyView>('front');

  const recoveryQuery = useQuery<MuscleRecoveryResponse>({
    queryKey: qk.analytics.muscleRecovery(),
    queryFn: async () => {
      const response = await api.get('/progress/muscle-recovery');
      return response.data as MuscleRecoveryResponse;
    },
    staleTime: STALE.short,
    retry: 1,
  });

  const groups = recoveryQuery.data?.muscle_groups ?? [];
  const groupByName = useMemo(
    () => new Map(groups.map((group) => [group.name, group])),
    [groups],
  );
  const selected = groupByName.get(selectedMuscle);

  const colorFor = (name: MuscleName) => {
    const group = groupByName.get(name);
    return STATUS_COLOR[group?.status ?? 'no_data'];
  };

  const selectMuscle = (name: MuscleName) => {
    setSelectedMuscle(name);
    if (name === 'Back') setView('back');
    if (name === 'Chest') setView('front');
  };

  if (recoveryQuery.isLoading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={COLORS.primaryGreen} size="small" style={{ marginVertical: 24 }} />
        <Text variant="caption" color={COLORS.textMuted} align="center">
          Loading recent muscle activity…
        </Text>
      </View>
    );
  }

  if (recoveryQuery.isError) {
    return (
      <View style={styles.card}>
        <SectionLabel label="MUSCLE RECOVERY" icon="body-outline" color={COLORS.primaryGreen} />
        <Text variant="body" color={COLORS.textSecondary}>
          Muscle recovery data could not be loaded.
        </Text>
        <Pressable onPress={() => recoveryQuery.refetch()} style={styles.retryButton}>
          <Ionicons name="refresh" size={14} color={COLORS.background} />
          <Text variant="caption" weight="bold" color={COLORS.background}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <SectionLabel label="MUSCLE RECOVERY EXPLORER" icon="body-outline" color={COLORS.primaryGreen} />
          <Text variant="caption" color={COLORS.textMuted}>
            Select a muscle to inspect your recent training load
          </Text>
        </View>
        <View style={styles.legendInline}>
          <View style={[styles.legendItem, { backgroundColor: COLORS.recoveryHigh }]} />
          <View style={[styles.legendItem, { backgroundColor: COLORS.recoveryMed }]} />
          <View style={[styles.legendItem, { backgroundColor: COLORS.recoveryLow }]} />
        </View>
      </View>

      <View style={styles.viewToggle}>
        {(['front', 'back'] as AnatomyView[]).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: view === item }}
            onPress={() => setView(item)}
            style={[styles.viewButton, view === item && styles.viewButtonActive]}
          >
            <Text
              variant="caption"
              weight="bold"
              color={view === item ? COLORS.background : COLORS.textSecondary}
            >
              {item.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.explorerLayout}>
        <View style={styles.figureWrap}>
          <AnatomyFigure
            view={view}
            selected={selectedMuscle}
            colorFor={colorFor}
            onSelect={selectMuscle}
          />
          <Text variant="caption" color={COLORS.textMuted}>
            {view === 'front' ? 'ANTERIOR VIEW' : 'POSTERIOR VIEW'}
          </Text>
        </View>

        <View style={styles.inspector}>
          <Text variant="eyebrow" color={COLORS.textMuted}>SELECTED MUSCLE</Text>
          <Text variant="h2" color={COLORS.text}>{selectedMuscle}</Text>

          {selected ? (
            <>
              <View style={styles.recoveryBlock}>
                <Text
                  variant="hero"
                  color={STATUS_COLOR[selected.status]}
                  numeric
                >
                  {selected.recovery_pct === null ? '—' : `${selected.recovery_pct}%`}
                </Text>
                <Text variant="caption" weight="bold" color={STATUS_COLOR[selected.status]}>
                  {STATUS_LABEL[selected.status].toUpperCase()}
                </Text>
                <Text variant="caption" color={COLORS.textMuted}>
                  Time-based recovery estimate
                </Text>
              </View>

              <View style={styles.metrics}>
                <View style={styles.metricCell}>
                  <Text variant="h2" color={COLORS.text} numeric>
                    {selected.working_sets_7d}
                  </Text>
                  <Text variant="caption" color={COLORS.textMuted}>WORKING SETS · 7D</Text>
                </View>
                <View style={styles.metricCell}>
                  <Text variant="h2" color={COLORS.text} numeric>
                    {formatVolume(selected.volume_7d_kg)}
                  </Text>
                  <Text variant="caption" color={COLORS.textMuted}>VOLUME · 7D</Text>
                </View>
              </View>

              <View style={styles.lastTrained}>
                <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
                <Text variant="caption" color={COLORS.textSecondary}>
                  Last trained: {formatElapsed(selected.hours_since_trained)}
                </Text>
              </View>

              <View style={styles.exerciseList}>
                <Text variant="caption" weight="bold" color={COLORS.textMuted}>
                  EXERCISES · LAST 7 DAYS
                </Text>
                {selected.exercises_7d.length > 0 ? (
                  selected.exercises_7d.slice(0, 4).map((exercise) => (
                    <View key={exercise} style={styles.exercisePill}>
                      <Text variant="caption" color={COLORS.textSecondary}>{exercise}</Text>
                    </View>
                  ))
                ) : (
                  <Text variant="caption" color={COLORS.textMuted}>
                    No working sets in the last 7 days
                  </Text>
                )}
              </View>
            </>
          ) : (
            <Text variant="caption" color={COLORS.textMuted}>
              No recent training data for this muscle group.
            </Text>
          )}
        </View>
      </View>

      <View style={styles.muscleSelector}>
        {MUSCLE_ORDER.map((name) => {
          const active = name === selectedMuscle;
          const group = groupByName.get(name);
          const status = group?.status ?? 'no_data';

          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => selectMuscle(name)}
              style={[
                styles.muscleChip,
                active && { borderColor: STATUS_COLOR[status] },
              ]}
            >
              <View style={[styles.legendItem, { backgroundColor: STATUS_COLOR[status] }]} />
              <Text
                variant="caption"
                weight={active ? 'bold' : 'medium'}
                color={active ? COLORS.text : COLORS.textSecondary}
              >
                {name}
              </Text>
              <Text variant="caption" color={STATUS_COLOR[status]} numeric>
                {group?.recovery_pct == null ? '—' : `${group.recovery_pct}%`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text variant="caption" color={COLORS.textMuted} style={styles.modelNote}>
        {recoveryQuery.data?.model_note ?? 'Recovery is estimated from time since logged working sets and broad muscle-group windows. It is not a direct measurement of readiness, soreness, or injury risk.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: SPACING.lg,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  headerCopy: { flex: 1, gap: 4 },
  legendInline: { flexDirection: 'row', gap: 5, paddingTop: 7 },
  legendItem: { width: 8, height: 8, borderRadius: 4 },
  viewToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 3,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.cardElevated,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  viewButton: {
    minWidth: 72,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.button,
  },
  viewButtonActive: {
    backgroundColor: COLORS.primaryGreen,
  },
  explorerLayout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  figureWrap: {
    flex: 1,
    minWidth: 170,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.backgroundTop,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.md,
  },
  inspector: {
    flex: 1,
    minWidth: 190,
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  recoveryBlock: {
    borderRadius: RADIUS.button,
    backgroundColor: COLORS.cardElevated,
    padding: SPACING.md,
    gap: 3,
  },
  metrics: { flexDirection: 'row', gap: SPACING.xs },
  metricCell: {
    flex: 1,
    minWidth: 0,
    borderRadius: RADIUS.button,
    backgroundColor: COLORS.cardElevated,
    padding: SPACING.sm,
    gap: 3,
  },
  lastTrained: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    flexWrap: 'wrap',
  },
  exerciseList: { gap: SPACING.xs },
  exercisePill: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.button,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.cardElevated,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  muscleSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  muscleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 7,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    backgroundColor: COLORS.cardElevated,
  },
  modelNote: {
    marginTop: SPACING.sm,
    lineHeight: 16,
    color: COLORS.textMuted,
  },
  retryButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: RADIUS.button,
    backgroundColor: COLORS.primaryGreen,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
  },
});
