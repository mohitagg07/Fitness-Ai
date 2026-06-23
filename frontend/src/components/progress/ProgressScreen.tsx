/**
 * NeuroFit AI — Progress Screen
 * - Weight log with chart
 * - FatSecret food search → auto-fill macros
 * - Daily macro donut chart (SVG)
 * - Motivational progress graphs (weight trend + calorie streak)
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import Svg, { Circle, Path, Line, Text as SvgText, G, Polyline } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { progressApi, fatsecretApi, describeApiError, FoodResult } from '../../utils/api';
import { COLORS } from '../../theme/colors';

// ─── Macro donut (matches Image 2 reference) ──────────────────────────────────
function MacroDonut({ calories, protein_g, carbs_g, fat_g }: {
  calories: number; protein_g: number; carbs_g: number; fat_g: number;
}) {
  const SIZE = 160; const CX = 80; const CY = 80; const R = 58; const SW = 14;
  const CIRC = 2 * Math.PI * R;
  const pCal = protein_g * 4; const cCal = carbs_g * 4; const fCal = fat_g * 9;
  const total = pCal + cCal + fCal || 1;
  const fPct = fCal / total; const cPct = cCal / total; const pPct = pCal / total;

  const segs = [
    { pct: fPct, color: '#E8A598', label: 'fat',     g: fat_g     },
    { pct: cPct, color: '#87CEEB', label: 'carbs',   g: carbs_g   },
    { pct: pPct, color: '#F5C842', label: 'protein', g: protein_g },
  ];

  let offset = 0;
  const arcs = segs.map(s => {
    const dash = s.pct * CIRC;
    const o = CIRC - offset;
    offset += dash;
    return { ...s, dash, offset: o };
  });

  return (
    <View style={dt.wrap}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={CX} cy={CY} r={R} stroke="#2A2A2A" strokeWidth={SW} fill="none" />
        {arcs.map((a, i) => (
          <Circle key={i} cx={CX} cy={CY} r={R}
            stroke={a.color} strokeWidth={SW} fill="none"
            strokeDasharray={`${a.dash} ${CIRC - a.dash}`}
            strokeDashoffset={a.offset}
            rotation="-90" originX={CX} originY={CY}
          />
        ))}
        <SvgText x={CX} y={CY - 8} textAnchor="middle" fill="#FFF" fontSize="22" fontWeight="800">{calories}</SvgText>
        <SvgText x={CX} y={CY + 12} textAnchor="middle" fill="#888" fontSize="12">Calories</SvgText>
      </Svg>
      <View style={dt.legend}>
        {segs.map(s => (
          <View key={s.label} style={dt.legendRow}>
            <View style={[dt.dot, { backgroundColor: s.color }]} />
            <Text style={dt.legendTxt}>
              {Math.round(s.pct * 100)}% {s.label}:{' '}
              <Text style={dt.legendBold}>{s.g.toFixed(2)}g</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
const dt = StyleSheet.create({
  wrap:      { flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 4 },
  legend:    { gap: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:       { width: 10, height: 10, borderRadius: 5 },
  legendTxt: { color: '#AAA', fontSize: 13 },
  legendBold:{ color: '#FFF', fontWeight: '700' },
});

// ─── Sparkline chart ──────────────────────────────────────────────────────────
function Sparkline({ data, color, label, unit }: {
  data: number[]; color: string; label: string; unit: string;
}) {
  if (data.length < 2) return (
    <View style={sp.empty}>
      <Text style={sp.emptyTxt}>Log more data to see your {label.toLowerCase()} trend</Text>
    </View>
  );
  const W = 280; const H = 72; const PAD = 8;
  const min = Math.min(...data); const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');
  const latest = data[data.length - 1];
  const delta = data.length > 1 ? +(latest - data[0]).toFixed(1) : 0;
  return (
    <View style={sp.wrap}>
      <View style={sp.header}>
        <Text style={sp.label}>{label.toUpperCase()}</Text>
        <View style={sp.delta}>
          <Ionicons
            name={delta > 0 ? 'trending-up' : delta < 0 ? 'trending-down' : 'remove'}
            size={13} color={delta <= 0 ? COLORS.recoveryHigh : COLORS.danger}
          />
          <Text style={[sp.deltaVal, { color: delta <= 0 ? COLORS.recoveryHigh : COLORS.danger }]}>
            {delta > 0 ? '+' : ''}{delta} {unit}
          </Text>
        </View>
      </View>
      <Text style={sp.current}>{latest} <Text style={sp.unit}>{unit}</Text></Text>
      <Svg width={W} height={H} style={sp.svg}>
        <Polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* dots at each data point */}
        {data.map((v, i) => {
          const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
          const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
          return <Circle key={i} cx={x} cy={y} r={i === data.length - 1 ? 4 : 2.5} fill={color} />;
        })}
      </Svg>
    </View>
  );
}
const sp = StyleSheet.create({
  wrap:     { gap: 2, paddingVertical: 4 },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label:    { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  delta:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deltaVal: { fontSize: 12, fontWeight: '700' },
  current:  { color: '#FFF', fontSize: 26, fontWeight: '800', marginVertical: 2 },
  unit:     { color: '#666', fontSize: 14, fontWeight: '400' },
  svg:      { marginTop: 4 },
  empty:    { paddingVertical: 24 },
  emptyTxt: { color: '#444', fontSize: 13, textAlign: 'center' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
const EMPTY_MEAL = { meal_name: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' };
type TabKey = 'body' | 'nutrition' | 'charts';

export default function ProgressScreen() {
  const [metrics,    setMetrics]    = useState<any[]>([]);
  const [nutrition,  setNutrition]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [activeTab,  setActiveTab]  = useState<TabKey>('nutrition');

  // Meal form
  const [meal,       setMeal]       = useState({ ...EMPTY_MEAL });
  const [logLoading, setLogLoading] = useState(false);

  // FatSecret search
  const [searchQ,    setSearchQ]    = useState('');
  const [results,    setResults]    = useState<FoodResult[]>([]);
  const [searching,  setSearching]  = useState(false);
  const [showDrop,   setShowDrop]   = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true); setErrorMsg(null);
    try {
      const [mR, nR] = await Promise.all([
        progressApi.getMetrics(30),
        progressApi.getNutritionHistory(14),
      ]);
      setMetrics(mR.data || []);
      setNutrition(nR.data || []);
    } catch (err: any) {
      setErrorMsg(describeApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  // FatSecret debounced search
  const onSearch = useCallback((text: string) => {
    setSearchQ(text);
    setMeal(p => ({ ...p, meal_name: text }));
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) { setResults([]); setShowDrop(false); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fatsecretApi.search(text.trim(), 8);
        setResults(r.data.results || []);
        setShowDrop(true);
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 500);
  }, []);

  const applyFood = (f: FoodResult) => {
    setMeal({
      meal_name: f.name + (f.brand ? ` (${f.brand})` : ''),
      calories:  String(f.calories),
      protein_g: String(f.protein_g),
      carbs_g:   String(f.carbs_g),
      fat_g:     String(f.fat_g),
    });
    setSearchQ(f.name);
    setResults([]); setShowDrop(false);
  };

  const logWeight = async () => {
    const w = parseFloat(weightInput);
    if (!w || w < 30 || w > 300) { Alert.alert('Invalid', 'Enter a weight between 30–300 kg.'); return; }
    try {
      await progressApi.logMetrics({ weight_kg: w });
      setWeightInput('');
      await loadData();
      Alert.alert('Logged ✓', `${w} kg recorded.`);
    } catch { Alert.alert('Error', 'Could not save weight.'); }
  };

  const logMeal = async () => {
    const cal = meal.calories  ? parseInt(meal.calories, 10)  : undefined;
    const pro = meal.protein_g ? parseFloat(meal.protein_g)   : undefined;
    const car = meal.carbs_g   ? parseFloat(meal.carbs_g)     : undefined;
    const fat = meal.fat_g     ? parseFloat(meal.fat_g)       : undefined;
    const nm  = meal.meal_name.trim() || undefined;
    if (!cal && !pro) { Alert.alert('Missing', 'Enter at least calories or protein.'); return; }
    setLogLoading(true);
    try {
      await progressApi.logNutrition({ meal_name: nm, calories: cal, protein_g: pro, carbs_g: car, fat_g: fat });
      setMeal({ ...EMPTY_MEAL }); setSearchQ('');
      await loadData();
      Alert.alert('Saved ✓', `${nm || 'Meal'} logged.`);
    } catch (err: any) {
      Alert.alert('Error', describeApiError(err).message);
    } finally { setLogLoading(false); }
  };

  // Today's donut data
  const todayStr  = new Date().toISOString().split('T')[0];
  const todayLogs = nutrition.filter(n => n.log_date === todayStr);
  const daily     = todayLogs.reduce(
    (a, n) => ({ calories: a.calories + (n.calories||0), protein_g: a.protein_g + (n.protein_g||0),
                  carbs_g: a.carbs_g + (n.carbs_g||0), fat_g: a.fat_g + (n.fat_g||0) }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  // Chart data
  const weightSeries = metrics.filter(m => m.weight_kg).map(m => m.weight_kg).reverse();
  const calSeries    = [...nutrition].reverse().map(n => n.calories || 0).filter(Boolean);

  const latestW  = metrics.find(m => m.weight_kg)?.weight_kg;
  const avgCal   = nutrition.length ? Math.round(nutrition.reduce((s,n) => s+(n.calories||0), 0) / nutrition.length) : null;

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={COLORS.primaryGreen} size="large" /></View>
  );

  const TABS: { key: TabKey; icon: any; label: string }[] = [
    { key: 'body',      icon: 'body-outline',       label: 'BODY'      },
    { key: 'nutrition', icon: 'restaurant-outline',  label: 'NUTRITION' },
    { key: 'charts',    icon: 'bar-chart-outline',   label: 'CHARTS'    },
  ];

  return (
    <ScrollView style={s.container} keyboardShouldPersistTaps="handled">

      <View style={s.header}>
        <View style={s.headerRow}>
          <View style={s.headerIcon}>
            <Ionicons name="stats-chart" size={17} color={COLORS.primaryGreen} />
          </View>
          <Text style={s.title}>Progress</Text>
        </View>
        {latestW && <Text style={s.sub}>Current weight: {latestW} kg</Text>}
      </View>

      {/* Hero stat row */}
      <View style={s.statsRow}>
        <View style={s.heroCard}>
          <Ionicons name="trending-up-outline" size={18} color={COLORS.primaryGreen} />
          {latestW ? (
            <>
              <Text style={s.heroVal}>{latestW}</Text>
              <Text style={s.heroUnit}>kg current</Text>
            </>
          ) : <Text style={s.heroEmpty}>Log a weigh-in to see trend</Text>}
        </View>
        <View style={s.stackCards}>
          <View style={s.smallCard}>
            <Ionicons name="restaurant-outline" size={15} color={COLORS.strain} />
            <Text style={s.smallVal}>{nutrition.length}</Text>
            <Text style={s.smallLbl}>meals logged</Text>
          </View>
          <View style={s.smallCard}>
            <Ionicons name="flame-outline" size={15} color="#FF9D5C" />
            <Text style={s.smallVal}>{avgCal ?? '—'}</Text>
            <Text style={s.smallLbl}>avg kcal/day</Text>
          </View>
        </View>
      </View>

      {/* Today's donut */}
      <View style={s.card}>
        <Text style={s.cardLabel}>TODAY'S MACROS</Text>
        {todayLogs.length > 0
          ? <MacroDonut {...daily} />
          : (
            <View style={s.donutEmpty}>
              <Ionicons name="pie-chart-outline" size={30} color="#333" />
              <Text style={s.donutEmptyTxt}>Log a meal to see today's breakdown</Text>
            </View>
          )}
      </View>

      {/* Weight log */}
      <View style={s.card}>
        <Text style={s.cardLabel}>LOG BODYWEIGHT</Text>
        <View style={s.row}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={weightInput}
            onChangeText={setWeightInput}
            placeholder="e.g. 76.5"
            placeholderTextColor="#444"
            keyboardType="decimal-pad"
          />
          <TouchableOpacity style={s.logBtn} onPress={logWeight}>
            <Ionicons name="add-circle-outline" size={14} color="#000" />
            <Text style={s.logBtnTxt}>LOG</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Meal log with FatSecret search */}
      <View style={[s.card, { zIndex: 20 }]}>
        <Text style={s.cardLabel}>LOG MEAL</Text>

        {/* Search row */}
        <View style={{ marginBottom: 10 }}>
          <View style={s.searchRow}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={searchQ}
              onChangeText={onSearch}
              placeholder="Search food (e.g. Chicken Rice)…"
              placeholderTextColor="#444"
            />
            {searching && <ActivityIndicator color={COLORS.primaryGreen} style={{ marginLeft: 8 }} size="small" />}
          </View>

          {showDrop && results.length > 0 && (
            <View style={s.dropdown}>
              {results.map(f => (
                <TouchableOpacity key={f.food_id} style={s.dropItem} onPress={() => applyFood(f)}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dropName} numberOfLines={1}>{f.name}</Text>
                    {f.brand ? <Text style={s.dropBrand}>{f.brand}</Text> : null}
                    <Text style={s.dropServing} numberOfLines={1}>{f.serving_description}</Text>
                  </View>
                  <Text style={s.dropMacros}>{f.calories} kcal · P {f.protein_g}g</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Macro inputs */}
        <View style={s.macroRow}>
          {[
            { k: 'calories',  lbl: 'KCAL',    col: COLORS.calories, pad: 'number-pad'  },
            { k: 'protein_g', lbl: 'PROTEIN',  col: COLORS.protein,  pad: 'decimal-pad' },
            { k: 'carbs_g',   lbl: 'CARBS',    col: COLORS.carbs,    pad: 'decimal-pad' },
            { k: 'fat_g',     lbl: 'FAT',      col: COLORS.fat,      pad: 'decimal-pad' },
          ].map(f => (
            <View key={f.k} style={s.macroField}>
              <Text style={[s.macroLbl, { color: f.col }]}>{f.lbl}</Text>
              <TextInput
                style={s.macroInput}
                value={(meal as any)[f.k]}
                onChangeText={v => setMeal(p => ({ ...p, [f.k]: v }))}
                placeholder="0"
                placeholderTextColor="#444"
                keyboardType={f.pad as any}
              />
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[s.logBtn, s.logBtnFull, logLoading && s.logBtnOff]}
          onPress={logMeal}
          disabled={logLoading}
        >
          {logLoading
            ? <ActivityIndicator color="#000" size="small" />
            : <><Ionicons name="add-circle-outline" size={14} color="#000" />
               <Text style={s.logBtnTxt}>SAVE MEAL</Text></>}
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[s.tab, activeTab === t.key && s.tabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Ionicons name={t.icon} size={13}
              color={activeTab === t.key ? COLORS.primaryGreen : '#444'} />
            <Text style={[s.tabTxt, activeTab === t.key && s.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Body tab */}
      {activeTab === 'body' && (
        <View style={s.card}>
          <Text style={s.cardLabel}>WEIGHT HISTORY</Text>
          {metrics.filter(m => m.weight_kg).length === 0
            ? <Text style={s.empty}>No weigh-ins yet. Use the form above.</Text>
            : metrics.filter(m => m.weight_kg).map((m, i) => (
                <View key={i} style={s.metricRow}>
                  <Text style={s.metricDate}>{m.recorded_date || '—'}</Text>
                  <Text style={s.metricVal}>{m.weight_kg} kg</Text>
                </View>
              ))}
        </View>
      )}

      {/* Nutrition tab */}
      {activeTab === 'nutrition' && (
        <View style={s.card}>
          <Text style={s.cardLabel}>RECENT MEALS</Text>
          {nutrition.length === 0
            ? <Text style={s.empty}>No logs yet. Search a food above and save it.</Text>
            : nutrition.map((n, i) => (
                <View key={i} style={s.metricRow}>
                  <View style={{ flex: 1 }}>
                    {n.meal_name ? <Text style={s.mealName}>{n.meal_name}</Text> : null}
                    <Text style={s.metricDate}>{n.log_date}</Text>
                    <Text style={s.metricSub}>
                      P: {n.protein_g ?? '—'}g · C: {n.carbs_g ?? '—'}g · F: {n.fat_g ?? '—'}g
                    </Text>
                  </View>
                  <Text style={s.metricVal}>{n.calories ?? '—'} kcal</Text>
                </View>
              ))}
        </View>
      )}

      {/* Charts tab — motivational graphs */}
      {activeTab === 'charts' && (
        <View style={{ gap: 0 }}>
          <View style={s.card}>
            <Text style={s.cardLabel}>WEIGHT TREND</Text>
            <Sparkline data={weightSeries} color={COLORS.primaryGreen} label="Weight" unit="kg" />
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>CALORIE INTAKE</Text>
            <Sparkline data={calSeries} color={COLORS.calories} label="Calories" unit="kcal" />
          </View>
          {nutrition.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardLabel}>STREAK MOTIVATION</Text>
              <View style={s.motivRow}>
                <View style={s.motivCard}>
                  <Text style={s.motivVal}>{nutrition.length}</Text>
                  <Text style={s.motivLbl}>meals logged</Text>
                </View>
                <View style={s.motivCard}>
                  <Text style={[s.motivVal, { color: COLORS.protein }]}>{avgCal ?? '—'}</Text>
                  <Text style={s.motivLbl}>avg kcal/day</Text>
                </View>
                <View style={s.motivCard}>
                  <Text style={[s.motivVal, { color: COLORS.recoveryHigh }]}>{weightSeries.length}</Text>
                  <Text style={s.motivLbl}>weigh-ins</Text>
                </View>
              </View>
              <View style={s.motivBanner}>
                <Ionicons name="trophy-outline" size={14} color={COLORS.primaryGreen} />
                <Text style={s.motivBannerTxt}>
                  {nutrition.length >= 7
                    ? 'Great consistency! You\'re building real habits.'
                    : `${7 - nutrition.length} more logs to unlock your first streak badge.`}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {errorMsg && (
        <View style={s.errCard}>
          <Ionicons name="warning-outline" size={13} color={COLORS.danger} />
          <Text style={s.errTxt}>{errorMsg}</Text>
        </View>
      )}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  center:    { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' },
  header:    { padding: 24, paddingTop: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#1A2535', alignItems: 'center', justifyContent: 'center' },
  title:     { color: '#FFF', fontSize: 26, fontWeight: '800' },
  sub:       { color: '#666', fontSize: 13, marginTop: 3 },
  statsRow:  { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 14 },
  heroCard:  { flex: 1.1, backgroundColor: '#1E1E1E', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2A2A2A', minHeight: 120, justifyContent: 'center' },
  heroVal:   { color: '#FFF', fontSize: 32, fontWeight: '800', marginTop: 6 },
  heroUnit:  { color: '#666', fontSize: 13, fontWeight: '600', marginTop: 2 },
  heroEmpty: { color: '#444', fontSize: 13, marginTop: 8, lineHeight: 18 },
  stackCards:{ flex: 1, gap: 10 },
  smallCard: { flex: 1, backgroundColor: '#1E1E1E', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#2A2A2A', justifyContent: 'center' },
  smallVal:  { color: '#FFF', fontSize: 18, fontWeight: '800', marginTop: 4 },
  smallLbl:  { color: '#666', fontSize: 10, fontWeight: '600', marginTop: 1 },
  card:      { backgroundColor: '#1E1E1E', borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2A2A2A' },
  cardLabel: { color: '#444', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  donutEmpty:{ alignItems: 'center', paddingVertical: 18, gap: 8 },
  donutEmptyTxt: { color: '#444', fontSize: 13 },
  row:       { flexDirection: 'row', gap: 10 },
  input:     { backgroundColor: '#252525', borderRadius: 12, padding: 14, color: '#FFF', fontSize: 15, borderWidth: 1, borderColor: '#2E2E2E' },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  dropdown:  { backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#2E2E2E', marginTop: 4, overflow: 'hidden' },
  dropItem:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#252525', gap: 8 },
  dropName:  { color: '#FFF', fontSize: 13, fontWeight: '600' },
  dropBrand: { color: '#555', fontSize: 11, marginTop: 1 },
  dropServing:{ color: '#444', fontSize: 10, marginTop: 1 },
  dropMacros:{ color: COLORS.primaryGreen, fontSize: 11, fontWeight: '700' },
  macroRow:  { flexDirection: 'row', gap: 8, marginBottom: 0 },
  macroField:{ flex: 1 },
  macroLbl:  { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4, textAlign: 'center' },
  macroInput:{ backgroundColor: '#252525', borderRadius: 10, padding: 10, color: '#FFF', fontSize: 15, textAlign: 'center' },
  logBtn:    { backgroundColor: COLORS.primaryGreen, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 46 },
  logBtnFull:{ width: '100%', marginTop: 12 },
  logBtnOff: { opacity: 0.5 },
  logBtnTxt: { color: '#000', fontWeight: '700', fontSize: 13 },
  tabs:      { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, gap: 6 },
  tab:       { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: '#1A1A1A', alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A', flexDirection: 'row', justifyContent: 'center', gap: 5 },
  tabActive: { backgroundColor: '#1E3A5F', borderColor: '#2A4A7F' },
  tabTxt:    { color: '#444', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  tabTxtActive:{ color: COLORS.primaryGreen },
  empty:     { color: '#444', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#222' },
  mealName:  { color: '#FFF', fontSize: 13, fontWeight: '600' },
  metricDate:{ color: '#666', fontSize: 12, marginTop: 1 },
  metricSub: { color: '#444', fontSize: 11, marginTop: 2 },
  metricVal: { color: COLORS.primaryGreen, fontSize: 14, fontWeight: '700' },
  motivRow:  { flexDirection: 'row', gap: 8, marginBottom: 10 },
  motivCard: { flex: 1, backgroundColor: '#252525', borderRadius: 10, padding: 12, alignItems: 'center' },
  motivVal:  { color: COLORS.strain, fontSize: 20, fontWeight: '800' },
  motivLbl:  { color: '#555', fontSize: 10, fontWeight: '600', marginTop: 2 },
  motivBanner:{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#0A1A0A', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#1A3A1A' },
  motivBannerTxt: { color: COLORS.primaryGreen, fontSize: 12, flex: 1, lineHeight: 17 },
  errCard:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12, backgroundColor: '#2A1010', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#4A2020' },
  errTxt:    { color: COLORS.danger, fontSize: 12, flex: 1 },
});
