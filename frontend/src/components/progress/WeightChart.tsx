/**
 * WeightChart
 * Renders a 14-day bodyweight trend line chart.
 * Data comes from progress_metrics rows already loaded in ProgressScreen.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Line, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { COLORS } from '../../theme/colors';

interface MetricPoint {
  weight_kg?: number | null;
  recorded_date?: string;
}

interface Props {
  metrics: MetricPoint[];
  goal?: string; // 'cut' | 'bulk' | 'maintain' | 'recomp'
}

const W = 320;
const H = 110;
const PAD = { top: 16, bottom: 24, left: 32, right: 12 };

export default function WeightChart({ metrics, goal }: Props) {
  // Filter to only points with weight, last 14 entries, oldest first
  const points = metrics
    .filter(m => m.weight_kg != null)
    .slice(0, 14)
    .reverse();

  if (points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Log at least 2 weigh-ins to see the trend.</Text>
      </View>
    );
  }

  const weights = points.map(p => p.weight_kg as number);
  const minW = Math.min(...weights) - 0.5;
  const maxW = Math.max(...weights) + 0.5;
  const range = maxW - minW || 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const toX = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const toY = (w: number) => PAD.top + plotH - ((w - minW) / range) * plotH;

  // Build SVG path
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.weight_kg as number).toFixed(1)}`)
    .join(' ');

  // Trend direction determines accent color
  const trend = weights[weights.length - 1] - weights[0];
  const isPositive = goal === 'bulk' ? trend >= 0 : trend <= 0;
  const lineColor = isPositive ? '#4CAF50' : '#FF5252';

  // Y-axis labels
  const yLabels = [minW + range * 0, minW + range * 0.5, minW + range * 1.0].map(v =>
    parseFloat(v.toFixed(1))
  );

  return (
    <View style={styles.container}>
      <Text style={styles.label}>WEIGHT TREND (14 DAYS)</Text>
      <Svg width={W} height={H}>
        <Defs>
          <LinearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
            <Stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        {/* Y-axis gridlines + labels */}
        {yLabels.map((w, i) => {
          const y = toY(w);
          return (
            <React.Fragment key={i}>
              <Line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                stroke="#2A2A2A" strokeWidth={1} strokeDasharray="3 3" />
              <SvgText x={PAD.left - 4} y={y + 4} fill="#555" fontSize={9} textAnchor="end">
                {w}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Area fill */}
        <Path
          d={`${pathD} L ${toX(points.length - 1).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L ${PAD.left.toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`}
          fill="url(#wg)"
        />

        {/* Line */}
        <Path d={pathD} fill="none" stroke={lineColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points */}
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={toX(i)} cy={toY(p.weight_kg as number)}
            r={i === points.length - 1 ? 4 : 2.5}
            fill={i === points.length - 1 ? lineColor : '#1C1C1C'}
            stroke={lineColor}
            strokeWidth={1.5}
          />
        ))}

        {/* First + last date labels */}
        {[0, points.length - 1].map(i => (
          <SvgText
            key={i} x={toX(i)} y={H - 4}
            fill="#555" fontSize={8} textAnchor={i === 0 ? 'start' : 'end'}
          >
            {(points[i].recorded_date || '').slice(5)}
          </SvgText>
        ))}
      </Svg>

      {/* Delta stat */}
      <View style={styles.deltaRow}>
        <Text style={styles.deltaLabel}>Change over period</Text>
        <Text style={[styles.deltaVal, isPositive ? styles.green : styles.red]}>
          {trend >= 0 ? '+' : ''}{trend.toFixed(1)} kg
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1C1C', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 16,
  },
  label: {
    color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10,
  },
  empty: { alignItems: 'center', paddingVertical: 16 },
  emptyText: { color: '#555', fontSize: 13 },
  deltaRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 8,
    borderTopWidth: 1, borderTopColor: '#2A2A2A', paddingTop: 8,
  },
  deltaLabel: { color: '#666', fontSize: 12 },
  deltaVal: { fontSize: 14, fontWeight: '700' },
  green: { color: '#4CAF50' },
  red: { color: '#FF5252' },
});
