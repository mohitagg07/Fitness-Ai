// VYRN — Nutrition Search & Quick-Log
//
// This screen previously didn't exist at all. The backend has had a
// working FatSecret-backed /api/nutrition/search + /quick-log since an
// earlier pass, but nothing in the frontend ever called it — so any
// search UI a user tried to wire up by hand would throw a plain
// "X is not a function" TypeError the moment the input changed (no
// `nutritionApi.searchFood` existed), crashing straight to the red error
// screen in dev. This is the actual, working implementation:
//
//   1. Debounced search-as-you-type (400ms) against GET /nutrition/search
//   2. Tap a result -> grams input appears with live-scaled macro preview
//   3. Tap "Log" -> POST /nutrition/quick-log (backend computes exact
//      macros for that food_id at that gram amount — no macro math here)
//   4. Falls back cleanly to the existing manual /nutrition/log entry
//      form if FatSecret is down (backend returns 502/503) or the user
//      just can't find what they ate.
import React, { useState, useRef, useCallback } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nutritionApi, progressApi, describeApiError } from '../../utils/api';
import { COLORS, alpha } from '../../theme/colors';
import ProfileAvatar from '../shared/ProfileAvatar';
import AmbientGlow from '../shared/AmbientGlow';

interface FoodResult {
  food_id: string;
  name: string;
  brand: string;
  food_type: string;
  serving_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

const DEBOUNCE_MS = 400;
const MIN_QUERY_LEN = 2;

interface FoodEstimate {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: 'low' | 'medium';
  assumptions: string[];
  portion_summary: string;
}

export default function NutritionSearchModal({
  visible,
  onClose,
  onLogged,
}: {
  visible: boolean;
  onClose: () => void;
  onLogged: () => void; // parent calls loadData() again after a successful log
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FoodResult | null>(null);
  const [grams, setGrams] = useState('100');
  const [logging, setLogging] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualAmount, setManualAmount] = useState('1 serving');
  const [manualPreparation, setManualPreparation] = useState('');
  const [estimatedFood, setEstimatedFood] = useState<FoodEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  // Plain setTimeout debounce — no extra dependency needed for one input.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0); // guards against an old slow response
  // overwriting a newer one's results if they resolve out of order.

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    const thisRequestId = ++requestIdRef.current;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await nutritionApi.searchFood(trimmed, 12);
      if (thisRequestId !== requestIdRef.current) return; // superseded
      setResults(res.data?.results || []);
    } catch (err: any) {
      if (thisRequestId !== requestIdRef.current) return;
      // 503 = FatSecret creds not configured on the backend; 502 = FatSecret
      // itself is down or rejected the request. Both are real, distinct
      // states the user should see — not a generic crash.
      const { message } = describeApiError(err);
      setSearchError(message);
      setResults([]);
    } finally {
      if (thisRequestId === requestIdRef.current) setSearching(false);
    }
  }, []);

  const onChangeQuery = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), DEBOUNCE_MS);
  };

  const closeAndReset = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestIdRef.current += 1;
    setQuery('');
    setResults([]);
    setSearchError(null);
    setSelected(null);
    setGrams('100');
    setManualMode(false);
    setManualName('');
    setManualAmount('1 serving');
    setManualPreparation('');
    setEstimatedFood(null);
    setEstimating(false);
    onClose();
  };

  const confirmLog = async () => {
    if (!selected) return;
    const g = parseFloat(grams);
    if (!g || g <= 0 || g > 5000) {
      Alert.alert('Invalid amount', 'Enter a gram amount between 1 and 5000.');
      return;
    }
    setLogging(true);
    try {
      await nutritionApi.quickLog(selected.food_id, g, selected.name);
      Alert.alert('Food logged', `${selected.name} (${g}g) added to today's log.`);
      onLogged();
      closeAndReset();
    } catch (err: any) {
      const { message } = describeApiError(err);
      Alert.alert('Could not log this meal', message);
    } finally {
      setLogging(false);
    }
  };

  const openManualEntry = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    requestIdRef.current += 1;
    setSearching(false);
    setSelected(null);
    setManualName(query.trim());
    setManualAmount('1 serving');
    setManualPreparation('');
    setEstimatedFood(null);
    setManualMode(true);
  };

  const estimateManualEntry = async () => {
    const name = manualName.trim();
    const portion = manualAmount.trim();
    if (name.length < 2) {
      Alert.alert('Food name required', 'Enter the name of the food you ate.');
      return;
    }
    if (!portion) {
      Alert.alert('Amount needed', 'Choose a portion such as 2 pieces, 1 bowl or 1 plate.');
      return;
    }

    setEstimating(true);
    setEstimatedFood(null);
    try {
      const response = await nutritionApi.estimateFood({
        food_name: name,
        portion,
        preparation: manualPreparation.trim() || undefined,
      });
      setEstimatedFood(response.data as FoodEstimate);
    } catch (err: any) {
      Alert.alert('Could not estimate this food', describeApiError(err).message);
    } finally {
      setEstimating(false);
    }
  };

  const saveManualEntry = async () => {
    const name = manualName.trim();
    if (!estimatedFood) {
      Alert.alert('Estimate first', 'Create and review the nutrition estimate before adding it.');
      return;
    }

    setLogging(true);
    try {
      await progressApi.logNutrition({
        meal_name: name,
        calories: Math.round(estimatedFood.calories),
        protein_g: estimatedFood.protein_g,
        carbs_g: estimatedFood.carbs_g,
        fat_g: estimatedFood.fat_g,
        notes: [
          'AI-estimated nutrition; user-confirmed',
          `Portion: ${manualAmount.trim()}`,
          `Confidence: ${estimatedFood.confidence}`,
          ...estimatedFood.assumptions,
        ].join(' · ').slice(0, 300),
      });
      onLogged();
      closeAndReset();
      Alert.alert('Food logged', `${name} was added using estimated nutrition values.`);
    } catch (err: any) {
      Alert.alert('Could not log food', describeApiError(err).message);
    } finally {
      setLogging(false);
    }
  };

  // Live-scaled preview based on the food's reference serving (FatSecret
  // returns per-serving macros in serving_description; we re-derive a
  // rough per-gram estimate client-side ONLY for the preview — the actual
  // saved values always come from the backend's authoritative computation
  // in /quick-log, which fetches food.get.v4 server-side.)
  const previewMacros = (() => {
    if (!selected) return null;
    const g = parseFloat(grams);
    if (!g || g <= 0) return null;
    // FatSecret's foods.search returns macros for ONE reference serving —
    // typically ~100g for generic foods, but not guaranteed. We treat the
    // returned numbers as "per 100g" for the live preview, which matches
    // FatSecret's typical convention; the backend's /quick-log call does
    // the precise per-serving math using food.get.v4, so this preview can
    // be approximate without the saved data ever being wrong.
    const ratio = g / 100;
    return {
      calories: Math.round(selected.calories * ratio),
      protein_g: +(selected.protein_g * ratio).toFixed(1),
      carbs_g: +(selected.carbs_g * ratio).toFixed(1),
      fat_g: +(selected.fat_g * ratio).toFixed(1),
    };
  })();

  // Stable across renders (deps: []) since it only touches item + the
  // two setters below, which are already stable — otherwise typing in
  // the search box (every keystroke re-renders this modal) would hand
  // FlashList a "new" renderItem on every character.
  const renderResultItem = useCallback(({ item }: { item: FoodResult }) => (
    <TouchableOpacity
      style={styles.resultRow}
      onPress={() => { setSelected(item); setGrams('100'); }}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
        {item.brand ? (
          <Text style={styles.resultBrand} numberOfLines={1}>{item.brand}</Text>
        ) : null}
        <Text style={styles.resultMacros}>
          {item.calories} kcal · P{item.protein_g}g · C{item.carbs_g}g · F{item.fat_g}g
        </Text>
      </View>
      <Ionicons name="add-circle" size={26} color={COLORS.primaryGreen} />
    </TouchableOpacity>
  ), []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeAndReset}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <AmbientGlow variant="workout" />
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity onPress={closeAndReset} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Log Food</Text>
          <ProfileAvatar size={34} />
        </View>

        {manualMode ? (
          <ScrollView
            style={styles.manualScroll}
            contentContainerStyle={[styles.manualWrap, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity style={styles.backRow} onPress={() => setManualMode(false)}>
              <Ionicons name="chevron-back" size={18} color={COLORS.textSecondary} />
              <Text style={styles.backText}>Back to food search</Text>
            </TouchableOpacity>

            <Text style={styles.manualTitle}>Tell me what you ate.</Text>
            <Text style={styles.manualSubtitle}>
              You don't need to know the calories or protein. VYRN will estimate the nutrition from the food and portion, show its assumptions, and ask you to confirm before saving.
            </Text>

            <Text style={styles.manualLabel}>FOOD OR MEAL NAME</Text>
            <TextInput
              style={styles.manualInput}
              value={manualName}
              onChangeText={(value) => { setManualName(value); setEstimatedFood(null); }}
              placeholder="e.g. Homemade paneer sandwich"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="words"
              keyboardAppearance="dark"
              selectionColor={COLORS.primaryGreen}
              underlineColorAndroid="transparent"
            />

            <Text style={styles.manualLabel}>HOW MUCH DID YOU EAT?</Text>
            <TextInput
              style={styles.manualInput}
              value={manualAmount}
              onChangeText={(value) => { setManualAmount(value); setEstimatedFood(null); }}
              placeholder="e.g. 2 medium pieces, 1 bowl, 1 plate"
              placeholderTextColor={COLORS.textMuted}
              keyboardAppearance="light"
              selectionColor={COLORS.primaryGreen}
              underlineColorAndroid="transparent"
            />
            <View style={styles.portionSuggestions}>
              {['1 piece', '2 pieces', '1 bowl', '1 plate'].map((portion) => (
                <TouchableOpacity
                  key={portion}
                  onPress={() => { setManualAmount(portion); setEstimatedFood(null); }}
                  style={[styles.portionChip, manualAmount === portion && styles.portionChipActive]}
                >
                  <Text style={[styles.portionChipText, manualAmount === portion && styles.portionChipTextActive]}>{portion}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.manualLabel}>ANY COOKING DETAILS? (OPTIONAL)</Text>
            <TextInput
              style={[styles.manualInput, styles.preparationInput]}
              value={manualPreparation}
              onChangeText={(value) => { setManualPreparation(value); setEstimatedFood(null); }}
              placeholder="e.g. homemade, deep fried, less oil, restaurant style"
              placeholderTextColor={COLORS.textMuted}
              multiline
              keyboardAppearance="light"
              selectionColor={COLORS.primaryGreen}
              underlineColorAndroid="transparent"
            />

            <TouchableOpacity
              style={[styles.confirmBtn, estimating && styles.confirmBtnDisabled]}
              onPress={estimateManualEntry}
              disabled={estimating || logging}
            >
              {estimating ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                  <Text style={styles.estimateBtnText}>ESTIMATE WITH VYRN</Text>
                </>
              )}
            </TouchableOpacity>

            {estimatedFood && (
              <View style={styles.estimateCard}>
                <View style={styles.estimateHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.estimateTitle}>Nutrition estimate</Text>
                    <Text style={styles.estimatePortion}>{estimatedFood.portion_summary}</Text>
                  </View>
                  <View style={[styles.confidencePill, estimatedFood.confidence === 'medium' ? styles.confidenceMedium : styles.confidenceLow]}>
                    <Text style={styles.confidenceText}>{estimatedFood.confidence.toUpperCase()} CONFIDENCE</Text>
                  </View>
                </View>
                <View style={styles.estimatedMacros}>
                  <MacroPill label="KCAL" value={String(estimatedFood.calories)} color={COLORS.calories} />
                  <MacroPill label="PROTEIN" value={`${estimatedFood.protein_g}g`} color={COLORS.protein} />
                  <MacroPill label="CARBS" value={`${estimatedFood.carbs_g}g`} color={COLORS.carbs} />
                  <MacroPill label="FAT" value={`${estimatedFood.fat_g}g`} color={COLORS.fat} />
                </View>
                {!!estimatedFood.assumptions?.length && (
                  <View style={styles.assumptionBlock}>
                    <Text style={styles.assumptionHeading}>WHAT VYRN ASSUMED</Text>
                    {estimatedFood.assumptions.map((assumption, index) => (
                      <Text key={index} style={styles.assumptionText}>• {assumption}</Text>
                    ))}
                  </View>
                )}
                <Text style={styles.estimateDisclaimer}>This is an approximate AI estimate. Actual nutrition varies with ingredients, recipe and portion size.</Text>
                <TouchableOpacity
                  style={[styles.confirmBtn, logging && styles.confirmBtnDisabled]}
                  onPress={saveManualEntry}
                  disabled={logging || estimating}
                >
                  {logging ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                      <Text style={styles.estimateBtnText}>ADD ESTIMATE TO DIARY</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        ) : !selected ? (
          <>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={COLORS.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={onChangeQuery}
                placeholder="Search ingredients, dishes or brands"
                placeholderTextColor={COLORS.textMuted}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
                keyboardAppearance="light"
                selectionColor={COLORS.primaryGreen}
                underlineColorAndroid="transparent"
              />
              {searching && <ActivityIndicator size="small" color={COLORS.primaryGreen} />}
            </View>

            <TouchableOpacity style={styles.manualLaunch} onPress={openManualEntry}>
              <Ionicons name="create-outline" size={16} color={COLORS.primaryGreen} />
              <Text style={styles.manualLaunchText}>Can't find it? Estimate with VYRN</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.primaryGreen} />
            </TouchableOpacity>

            {searchError ? (
              <View style={styles.centerMsg}>
                <Ionicons name="alert-circle-outline" size={28} color={COLORS.recoveryLow} />
                <Text style={styles.errorText}>{searchError}</Text>
                <Text style={styles.errorHint}>You can still estimate this meal with VYRN.</Text>
              </View>
            ) : query.trim().length > 0 && query.trim().length < MIN_QUERY_LEN ? (
              <View style={styles.centerMsg}>
                <Text style={styles.hintText}>Keep typing — at least {MIN_QUERY_LEN} characters.</Text>
              </View>
            ) : !searching && query.trim().length >= MIN_QUERY_LEN && results.length === 0 ? (
              <View style={styles.centerMsg}>
                <Ionicons name="search-outline" size={28} color={COLORS.textMuted} />
                <Text style={styles.hintText}>No database results for "{query.trim()}".</Text>
                <TouchableOpacity style={styles.noResultButton} onPress={openManualEntry}>
                  <Text style={styles.noResultButtonText}>Estimate this food with VYRN</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlashList
                data={results}
                keyExtractor={(item) => item.food_id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.resultsList}
                renderItem={renderResultItem}
              />
            )}
          </>
        ) : (
          /* ── Selected food: gram entry + live preview ── */
          <View style={styles.detailWrap}>
            <TouchableOpacity style={styles.backRow} onPress={() => setSelected(null)}>
              <Ionicons name="chevron-back" size={18} color={COLORS.textSecondary} />
              <Text style={styles.backText}>Back to results</Text>
            </TouchableOpacity>

            <Text style={styles.detailName}>{selected.name}</Text>
            {selected.brand ? <Text style={styles.detailBrand}>{selected.brand}</Text> : null}

            <View style={styles.gramsRow}>
              <Text style={styles.gramsLabel}>AMOUNT</Text>
              <View style={styles.gramsInputWrap}>
                <TextInput
                  style={styles.gramsInput}
                  value={grams}
                  onChangeText={setGrams}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
                <Text style={styles.gramsUnit}>g</Text>
              </View>
            </View>

            {previewMacros && (
              <View style={styles.macroPreview}>
                <MacroPill label="KCAL" value={String(previewMacros.calories)} color={COLORS.calories} />
                <MacroPill label="PROTEIN" value={`${previewMacros.protein_g}g`} color={COLORS.protein} />
                <MacroPill label="CARBS" value={`${previewMacros.carbs_g}g`} color={COLORS.carbs} />
                <MacroPill label="FAT" value={`${previewMacros.fat_g}g`} color={COLORS.fat} />
              </View>
            )}

            <Text style={styles.previewNote}>
              Final macros are computed precisely server-side from this food's exact serving data.
            </Text>

            <TouchableOpacity
              style={[styles.confirmBtn, logging && styles.confirmBtnDisabled]}
              onPress={confirmLog}
              disabled={logging}
            >
              {logging ? (
                <ActivityIndicator color={COLORS.background} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.background} />
                  <Text style={styles.confirmBtnText}>LOG THIS MEAL</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MacroPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[pillStyles.wrap, { borderColor: color + '40' }]}>
      <Text style={[pillStyles.value, { color }]}>{value}</Text>
      <Text style={pillStyles.label}>{label}</Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    backgroundColor: COLORS.cardElevated, borderRadius: 12, borderWidth: 1, gap: 4,
  },
  value: { fontSize: 16, fontWeight: '800' },
  label: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  manualScroll: { flex: 1 },
  manualWrap: { paddingHorizontal: 20, paddingTop: 18, gap: 10 },
  manualTitle: { color: COLORS.text, fontSize: 25, lineHeight: 30, fontWeight: '800', marginTop: 4 },
  manualSubtitle: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  manualLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginTop: 5 },
  manualInput: { color: COLORS.text, backgroundColor: COLORS.inputBg, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, minHeight: 48 },
  portionSuggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  portionChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.cardElevated },
  portionChipActive: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  portionChipText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
  portionChipTextActive: { color: COLORS.background },
  preparationInput: { minHeight: 72, textAlignVertical: 'top' },
  estimateBtnText: { color: COLORS.background, fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  estimateCard: { marginTop: 16, padding: 14, borderRadius: 24, backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.borderLight, gap: 12 },
  estimateHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  estimateTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  estimatePortion: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 4 },
  confidencePill: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1 },
  confidenceMedium: { backgroundColor: alpha(COLORS.recoveryHigh, 0.12), borderColor: alpha(COLORS.recoveryHigh, 0.4) },
  confidenceLow: { backgroundColor: alpha(COLORS.recoveryMed, 0.12), borderColor: alpha(COLORS.recoveryMed, 0.4) },
  confidenceText: { color: COLORS.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  estimatedMacros: { flexDirection: 'row', gap: 7 },
  assumptionBlock: { paddingTop: 9, borderTopWidth: 1, borderTopColor: COLORS.border, gap: 5 },
  assumptionHeading: { color: COLORS.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  assumptionText: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 16 },
  estimateDisclaimer: { color: COLORS.textMuted, fontSize: 10, lineHeight: 15 },
  manualLaunch: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, marginHorizontal: 20, marginTop: 12, paddingVertical: 7 },
  manualLaunchText: { color: COLORS.primaryGreen, fontSize: 12, fontWeight: '700' },
  noResultButton: { marginTop: 8, borderRadius: 12, backgroundColor: COLORS.cardElevated, paddingVertical: 11, paddingHorizontal: 16, borderWidth: 1, borderColor: COLORS.border },
  noResultButtonText: { color: COLORS.primaryGreen, fontSize: 12, fontWeight: '700' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.inputBg, borderRadius: 14,
    marginHorizontal: 16, marginTop: 16, paddingHorizontal: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 15, paddingVertical: 13 },
  centerMsg: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
  hintText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center' },
  errorText: { color: COLORS.recoveryLow, fontSize: 14, textAlign: 'center', fontWeight: '600' },
  errorHint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center' },
  resultsList: { padding: 16, gap: 8 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.card, borderRadius: 20, padding: 16,
    borderWidth: 1, borderColor: COLORS.borderLight, marginBottom: 8,
  },
  resultName: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  resultBrand: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  resultMacros: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  detailWrap: { flex: 1, padding: 20 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 20 },
  backText: { color: COLORS.textSecondary, fontSize: 13 },
  detailName: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  detailBrand: { color: COLORS.textMuted, fontSize: 13, marginTop: 2, marginBottom: 20 },
  gramsRow: { marginTop: 16, marginBottom: 20 },
  gramsLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 },
  gramsInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.inputBg, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 16,
  },
  gramsInput: { flex: 1, color: COLORS.text, fontSize: 28, fontWeight: '800', paddingVertical: 14 },
  gramsUnit: { color: COLORS.textMuted, fontSize: 18, fontWeight: '600' },
  macroPreview: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  previewNote: { color: COLORS.textDim, fontSize: 11, textAlign: 'center', marginBottom: 24, lineHeight: 16 },
  confirmBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 18, padding: 17,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 'auto',
  },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmBtnText: { color: COLORS.background, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
});