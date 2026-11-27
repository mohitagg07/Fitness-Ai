import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Circle, Line, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';

import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import { RADIUS, SPACING } from '../../theme/spacing';

interface MetricPoint {
  weight_kg?: number | null;
  recorded_date?: string;
}

interface Props {
  metrics: MetricPoint[];
}

const HEIGHT = 132;
const PAD = { top: 18, bottom: 25, left: 38, right: 12 };

export default function WeightChart({ metrics }: Props) {
  const [chartWidth, setChartWidth] = useState(320);
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width - SPACING.lg * 2);
    if (next > 0 && next !== chartWidth) setChartWidth(next);
  };
  const points = metrics
    .filter((metric) => metric.weight_kg != null && Number.isFinite(Number(metric.weight_kg)))
    .slice(0, 14)
    .reverse();

  if (points.length < 2) {
    return (
      <View style={styles.empty} onLayout={onLayout}>
        <Text style={styles.label}>BODYWEIGHT TREND</Text>
        <Text style={styles.emptyText}>Log at least two weigh-ins to see your trend.</Text>
      </View>
    );
  }

  const width = Math.max(240, chartWidth);
  const weights = points.map((point) => Number(point.weight_kg));
  const minWeight = Math.min(...weights) - 0.5;
  const maxWeight = Math.max(...weights) + 0.5;
  const range = maxWeight - minWeight || 1;
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const toX = (index: number) => PAD.left + (index / (points.length - 1)) * plotWidth;
  const toY = (weight: number) => PAD.top + plotHeight - ((weight - minWeight) / range) * plotHeight;
  const pathD = points
    .map((point, index) => (index === 0 ? 'M ' : 'L ') + toX(index).toFixed(1) + ' ' + toY(Number(point.weight_kg)).toFixed(1))
    .join(' ');
  const lineColor = COLORS.strain;
  const delta = weights[weights.length - 1] - weights[0];

  return (
    <View style={styles.container} onLayout={onLayout}>
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>BODYWEIGHT TREND</Text>
          <Text style={styles.subtitle}>Recent logged measurements</Text>
        </View>
        <View style={styles.periodPill}><Text style={styles.periodText}>14 ENTRIES MAX</Text></View>
      </View>

      <Svg width={width} height={HEIGHT} viewBox={'0 0 ' + width + ' ' + HEIGHT}>
        <Defs>
          <LinearGradient id="vyrn-weight-area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
            <Stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
          </LinearGradient>
        </Defs>
        {[0, 0.5, 1].map((ratio) => {
          const value = minWeight + range * ratio;
          const y = toY(value);
          return (
            <React.Fragment key={ratio}>
              <Line x1={PAD.left} y1={y} x2={width - PAD.right} y2={y} stroke={COLORS.border} strokeWidth={1} strokeDasharray="3 5" />
              <SvgText x={PAD.left - 7} y={y + 3} fill={COLORS.textDim} fontSize={9} textAnchor="end">{value.toFixed(1)}</SvgText>
            </React.Fragment>
          );
        })}
        <Path
          d={pathD + ' L ' + toX(points.length - 1).toFixed(1) + ' ' + (PAD.top + plotHeight).toFixed(1) +
            ' L ' + PAD.left.toFixed(1) + ' ' + (PAD.top + plotHeight).toFixed(1) + ' Z'}
          fill="url(#vyrn-weight-area)"
        />
        <Path d={pathD} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <Circle
            key={(point.recorded_date || 'point') + '-' + index}
            cx={toX(index)}
            cy={toY(Number(point.weight_kg))}
            r={index === points.length - 1 ? 4.5 : 2.7}
            fill={index === points.length - 1 ? COLORS.primaryGreen : COLORS.card}
            stroke={lineColor}
            strokeWidth={1.7}
          />
        ))}
        {[0, points.length - 1].map((index) => (
          <SvgText key={index} x={toX(index)} y={HEIGHT - 5} fill={COLORS.textMuted} fontSize={9} textAnchor={index === 0 ? 'start' : 'end'}>
            {(points[index].recorded_date || '').slice(5) || '—'}
          </SvgText>
        ))}
      </Svg>

      <View style={styles.deltaRow}>
        <View>
          <Text style={styles.deltaLabel}>Change across recorded period</Text>
          <Text style={styles.deltaHint}>Direction is not scored as good or bad.</Text>
        </View>
        <Text style={styles.deltaValue}>{delta > 0 ? '+' : ''}{delta.toFixed(1)} kg</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.card, borderRadius: RADIUS.card, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: SPACING.lg },
  empty: { backgroundColor: COLORS.card, borderRadius: RADIUS.card, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: SPACING.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  label: { color: COLORS.textSecondary, fontFamily: FONTS.bold, fontSize: 9, letterSpacing: 1.2 },
  subtitle: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 10, marginTop: 4 },
  periodPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.cardElevated },
  periodText: { color: COLORS.textMuted, fontFamily: FONTS.bold, fontSize: 7, letterSpacing: 0.55 },
  emptyText: { color: COLORS.textMuted, fontFamily: FONTS.regular, fontSize: 12, marginTop: 9 },
  deltaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  deltaLabel: { color: COLORS.textSecondary, fontFamily: FONTS.semibold, fontSize: 10 },
  deltaHint: { color: COLORS.textDim, fontFamily: FONTS.regular, fontSize: 9, marginTop: 3 },
  deltaValue: { color: COLORS.strain, fontFamily: FONTS.numericBold, fontSize: 16 },
});
