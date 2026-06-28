import { useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ScrollView, Dimensions, KeyboardAvoidingView,
  Platform, ActivityIndicator,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { profileApi } from '../../utils/api';
import { actions } from '../../store';
import { storage } from '../../utils/storage';
import { COLORS } from '../../theme/colors';

const { width: SCREEN_W } = Dimensions.get('window');
const RING_SIZE = 84;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type Gender = 'male' | 'female' | 'other';
type Goal = 'cut' | 'bulk' | 'maintain' | 'recomp';
type Experience = 'beginner' | 'intermediate' | 'advanced' | 'elite';
type Location = 'home' | 'gym' | 'hybrid';
type CoachStyle = 'friendly' | 'strict' | 'military';
type DietType = 'veg' | 'eggetarian' | 'non-veg';

interface FormState {
  full_name: string;
  age: string;
  gender: Gender | null;
  height_cm: string;
  weight_kg: string;
  target_weight_kg: string;
  goal: Goal | null;
  experience_level: Experience | null;
  gym_or_home: Location | null;
  workout_days_per_week: number;
  diet_type: DietType | null;
  coach_style: CoachStyle | null;
}

const initialForm: FormState = {
  full_name: '',
  age: '',
  gender: null,
  height_cm: '',
  weight_kg: '',
  target_weight_kg: '',
  goal: null,
  experience_level: null,
  gym_or_home: null,
  workout_days_per_week: 4,
  diet_type: null,
  coach_style: null,
};

const SLIDE_COUNT = 5;

// Simple TDEE + macro calculator for the summary slide
function calcTargets(form: FormState) {
  const w = parseFloat(form.weight_kg) || 75;
  const h = parseFloat(form.height_cm) || 175;
  const a = parseInt(form.age) || 25;
  const isMale = form.gender !== 'female';
  // Mifflin-St Jeor BMR
  const bmr = isMale
    ? 10 * w + 6.25 * h - 5 * a + 5
    : 10 * w + 6.25 * h - 5 * a - 161;
  const activityFactor = form.workout_days_per_week >= 5 ? 1.55 : form.workout_days_per_week >= 3 ? 1.45 : 1.375;
  let tdee = bmr * activityFactor;
  if (form.goal === 'cut') tdee -= 400;
  else if (form.goal === 'bulk') tdee += 300;
  const protein = Math.round(w * 2.0);
  const fat = Math.round((tdee * 0.25) / 9);
  const carbs = Math.round((tdee - protein * 4 - fat * 9) / 4);
  return { calories: Math.round(tdee), protein, carbs, fat };
}

function isSlideValid(slide: number, form: FormState): boolean {
  switch (slide) {
    case 0: return form.full_name.trim().length > 0 && !!form.age && !!form.gender;
    case 1: return !!form.height_cm && !!form.weight_kg && !!form.goal;
    case 2: return !!form.experience_level && !!form.gym_or_home;
    case 3: return !!form.diet_type;
    case 4: return !!form.coach_style;
    default: return false;
  }
}

export default function OnboardingScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const [slide, setSlide] = useState(0);
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ringProgress = useSharedValue(1 / SLIDE_COUNT);

  const goToSlide = (index: number) => {
    setSlide(index);
    scrollRef.current?.scrollTo({ x: index * SCREEN_W, animated: true });
    ringProgress.value = withTiming((index + 1) / SLIDE_COUNT, { duration: 350 });
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await profileApi.onboard({
        ...form,
        age: parseInt(form.age),
        height_cm: parseFloat(form.height_cm),
        weight_kg: parseFloat(form.weight_kg),
        target_weight_kg: form.target_weight_kg ? parseFloat(form.target_weight_kg) : undefined,
        food_preference: form.diet_type,
      });
      await storage.setItem('neurofit_onboarded', 'true');
      router.replace('/(tabs)');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const ringAnimStyle = useAnimatedStyle(() => ({
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - ringProgress.value),
  }));

  function Chip<T extends string>({
    label, value, current, onSelect, emoji,
  }: { label: string; value: T; current: T | null; onSelect: (v: T) => void; emoji?: string }) {
    const active = current === value;
    return (
      <Pressable style={[styles.chip, active && styles.chipActive]} onPress={() => onSelect(value)}>
        {emoji && <Text style={styles.chipEmoji}>{emoji}</Text>}
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </Pressable>
    );
  }

  const targets = calcTargets(form);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE}>
          <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} stroke="#2A2A2A" strokeWidth={RING_STROKE} fill="none" />
          <AnimatedCircle
            cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
            stroke={COLORS.primaryGreen} strokeWidth={RING_STROKE} fill="none"
            strokeDasharray={RING_CIRCUMFERENCE}
            animStyle={ringAnimStyle}
          />
        </Svg>
        <View style={styles.ringLabel}>
          <Text style={styles.ringNum}>{slide + 1}</Text>
          <Text style={styles.ringOf}>/{SLIDE_COUNT}</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal pagingEnabled scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Slide 0: Identity ── */}
        <View style={styles.slide}>
          <Text style={styles.slideTitle}>Let's get started</Text>
          <Text style={styles.slideSub}>Tell us about yourself</Text>
          <Text style={styles.label}>Your name</Text>
          <TextInput style={styles.input} value={form.full_name} onChangeText={(v) => setField('full_name', v)} placeholder="e.g. Mohit" placeholderTextColor="#555" />
          <Text style={styles.label}>Age</Text>
          <TextInput style={styles.input} value={form.age} onChangeText={(v) => setField('age', v)} placeholder="22" placeholderTextColor="#555" keyboardType="number-pad" />
          <Text style={styles.label}>Gender</Text>
          <View style={styles.chips}>
            <Chip label="Male" value="male" current={form.gender} onSelect={(v) => setField('gender', v)} emoji="♂️" />
            <Chip label="Female" value="female" current={form.gender} onSelect={(v) => setField('gender', v)} emoji="♀️" />
            <Chip label="Other" value="other" current={form.gender} onSelect={(v) => setField('gender', v)} />
          </View>
        </View>

        {/* ── Slide 1: Body & Goal ── */}
        <View style={styles.slide}>
          <Text style={styles.slideTitle}>Your body & goal</Text>
          <Text style={styles.slideSub}>We'll build your plan around this</Text>
          <View style={styles.row2}>
            <View style={styles.half}>
              <Text style={styles.label}>Height (cm)</Text>
              <TextInput style={styles.input} value={form.height_cm} onChangeText={(v) => setField('height_cm', v)} placeholder="175" placeholderTextColor="#555" keyboardType="decimal-pad" />
            </View>
            <View style={styles.half}>
              <Text style={styles.label}>Weight (kg)</Text>
              <TextInput style={styles.input} value={form.weight_kg} onChangeText={(v) => setField('weight_kg', v)} placeholder="75" placeholderTextColor="#555" keyboardType="decimal-pad" />
            </View>
          </View>
          <Text style={styles.label}>Target weight (kg, optional)</Text>
          <TextInput style={styles.input} value={form.target_weight_kg} onChangeText={(v) => setField('target_weight_kg', v)} placeholder="80" placeholderTextColor="#555" keyboardType="decimal-pad" />
          <Text style={styles.label}>Primary goal</Text>
          <View style={styles.chips}>
            <Chip label="Bulk" value="bulk" current={form.goal} onSelect={(v) => setField('goal', v)} emoji="💪" />
            <Chip label="Cut" value="cut" current={form.goal} onSelect={(v) => setField('goal', v)} emoji="🔥" />
            <Chip label="Maintain" value="maintain" current={form.goal} onSelect={(v) => setField('goal', v)} emoji="⚖️" />
            <Chip label="Recomp" value="recomp" current={form.goal} onSelect={(v) => setField('goal', v)} emoji="↕️" />
          </View>
        </View>

        {/* ── Slide 2: Training setup ── */}
        <View style={styles.slide}>
          <Text style={styles.slideTitle}>Training setup</Text>
          <Text style={styles.slideSub}>Optimise your programming</Text>
          <Text style={styles.label}>Experience level</Text>
          <View style={styles.chips}>
            <Chip label="Beginner" value="beginner" current={form.experience_level} onSelect={(v) => setField('experience_level', v)} />
            <Chip label="Intermediate" value="intermediate" current={form.experience_level} onSelect={(v) => setField('experience_level', v)} />
            <Chip label="Advanced" value="advanced" current={form.experience_level} onSelect={(v) => setField('experience_level', v)} />
            <Chip label="Elite" value="elite" current={form.experience_level} onSelect={(v) => setField('experience_level', v)} />
          </View>
          <Text style={styles.label}>Where do you train?</Text>
          <View style={styles.chips}>
            <Chip label="Gym" value="gym" current={form.gym_or_home} onSelect={(v) => setField('gym_or_home', v)} emoji="🏋️" />
            <Chip label="Home" value="home" current={form.gym_or_home} onSelect={(v) => setField('gym_or_home', v)} emoji="🏠" />
            <Chip label="Hybrid" value="hybrid" current={form.gym_or_home} onSelect={(v) => setField('gym_or_home', v)} emoji="🔄" />
          </View>
          <Text style={styles.label}>Days per week: {form.workout_days_per_week}</Text>
          <View style={styles.stepper}>
            {[3, 4, 5, 6].map((d) => (
              <Pressable key={d} style={[styles.stepperBtn, form.workout_days_per_week === d && styles.stepperBtnActive]} onPress={() => setField('workout_days_per_week', d)}>
                <Text style={[styles.stepperText, form.workout_days_per_week === d && styles.stepperTextActive]}>{d}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Slide 3: Diet type (NEW) ── */}
        <View style={styles.slide}>
          <Text style={styles.slideTitle}>Your diet</Text>
          <Text style={styles.slideSub}>We'll personalise your nutrition plan around this</Text>

          {([
            ['veg', '🥦', 'Vegetarian', 'No meat, no eggs. Plant-based proteins only.'],
            ['eggetarian', '🥚', 'Eggetarian', 'Vegetarian + eggs. No meat or fish.'],
            ['non-veg', '🍗', 'Non-Veg', 'All foods including meat, fish, and eggs.'],
          ] as [DietType, string, string, string][]).map(([val, emoji, label, desc]) => (
            <Pressable
              key={val}
              style={[styles.coachCard, form.diet_type === val && styles.coachCardActive]}
              onPress={() => setField('diet_type', val)}
            >
              <View style={styles.coachCardRow}>
                <Text style={styles.dietEmoji}>{emoji}</Text>
                <View style={[styles.coachRadio, form.diet_type === val && styles.coachRadioActive]}>
                  {form.diet_type === val && <View style={styles.coachRadioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.coachCardLabel, form.diet_type === val && { color: COLORS.primaryGreen }]}>{label}</Text>
                  <Text style={styles.coachCardDesc}>{desc}</Text>
                </View>
              </View>
            </Pressable>
          ))}

          {/* Show calculated targets */}
          {form.weight_kg && form.height_cm && form.goal && (
            <View style={styles.targetPreview}>
              <Text style={styles.targetPreviewTitle}>Your estimated daily targets</Text>
              <View style={styles.targetRow}>
                <TargetPill label="Calories" value={`${targets.calories}`} unit="kcal" color="#FF9D5C" />
                <TargetPill label="Protein" value={`${targets.protein}`} unit="g" color="#4ADE80" />
                <TargetPill label="Carbs" value={`${targets.carbs}`} unit="g" color="#60A5FA" />
                <TargetPill label="Fat" value={`${targets.fat}`} unit="g" color="#FBBF24" />
              </View>
            </View>
          )}
        </View>

        {/* ── Slide 4: Coach personality ── */}
        <View style={styles.slide}>
          <Text style={styles.slideTitle}>Pick your coach</Text>
          <Text style={styles.slideSub}>This shapes how I talk to you — every message, every session</Text>

          {([
            ['friendly', '😊', 'Friendly', 'Supportive, encouraging, celebrates small wins'],
            ['strict', '📊', 'Strict', 'Direct, data-driven, no fluff'],
            ['military', '🪖', 'Military', 'Hard, no excuses — push past limits'],
          ] as [CoachStyle, string, string, string][]).map(([val, emoji, label, desc]) => (
            <Pressable
              key={val}
              style={[styles.coachCard, form.coach_style === val && styles.coachCardActive]}
              onPress={() => setField('coach_style', val)}
            >
              <View style={styles.coachCardRow}>
                <Text style={styles.dietEmoji}>{emoji}</Text>
                <View style={[styles.coachRadio, form.coach_style === val && styles.coachRadioActive]}>
                  {form.coach_style === val && <View style={styles.coachRadioDot} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.coachCardLabel, form.coach_style === val && { color: COLORS.primaryGreen }]}>{label}</Text>
                  <Text style={styles.coachCardDesc}>{desc}</Text>
                </View>
              </View>
            </Pressable>
          ))}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      </ScrollView>

      <View style={styles.navRow}>
        {slide > 0 && (
          <Pressable style={styles.backBtn} onPress={() => goToSlide(slide - 1)}>
            <Ionicons name="arrow-back" size={18} color="#888" />
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        {slide < SLIDE_COUNT - 1 ? (
          <Pressable
            style={[styles.nextBtn, !isSlideValid(slide, form) && styles.nextBtnDisabled]}
            onPress={() => isSlideValid(slide, form) && goToSlide(slide + 1)}
            disabled={!isSlideValid(slide, form)}
          >
            <Text style={styles.nextBtnText}>Next</Text>
            <Ionicons name="arrow-forward" size={16} color="#000" />
          </Pressable>
        ) : (
          <Pressable
            style={[styles.nextBtn, (!isSlideValid(slide, form) || submitting) && styles.nextBtnDisabled]}
            onPress={handleSubmit}
            disabled={!isSlideValid(slide, form) || submitting}
          >
            {submitting
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={styles.nextBtnText}>Start Training</Text>
            }
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function TargetPill({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <View style={styles.targetPill}>
      <Text style={[styles.targetPillValue, { color }]}>{value}</Text>
      <Text style={styles.targetPillUnit}>{unit}</Text>
      <Text style={styles.targetPillLabel}>{label}</Text>
    </View>
  );
}

function AnimatedCircle({ animStyle, ...props }: any) {
  const AnimC = Animated.createAnimatedComponent(Circle);
  return <AnimC {...props} animatedProps={animStyle} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121212' },
  ringWrap: { alignSelf: 'center', marginTop: 60, marginBottom: 8, width: RING_SIZE, height: RING_SIZE, justifyContent: 'center', alignItems: 'center' },
  ringLabel: { position: 'absolute', flexDirection: 'row', alignItems: 'baseline' },
  ringNum: { color: '#FFF', fontSize: 20, fontFamily: 'Inter_700Bold' },
  ringOf: { color: '#555', fontSize: 13, fontFamily: 'Inter_400Regular' },
  slide: { width: SCREEN_W, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },
  slideTitle: { color: '#FFF', fontSize: 26, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  slideSub: { color: '#888', fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 24 },
  label: { color: '#888', fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#1E1E1E', borderRadius: 12, padding: 14, color: '#FFF', fontSize: 16, fontFamily: 'Inter_400Regular', borderWidth: 1, borderColor: '#2A2A2A' },
  row2: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A', flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipActive: { borderColor: COLORS.primaryGreen, backgroundColor: COLORS.primaryGreen + '18' },
  chipEmoji: { fontSize: 14 },
  chipText: { color: '#888', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  chipTextActive: { color: COLORS.primaryGreen },
  stepper: { flexDirection: 'row', gap: 10, marginTop: 4 },
  stepperBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A', alignItems: 'center' },
  stepperBtnActive: { borderColor: COLORS.primaryGreen, backgroundColor: COLORS.primaryGreen + '18' },
  stepperText: { color: '#555', fontSize: 16, fontFamily: 'Inter_700Bold' },
  stepperTextActive: { color: COLORS.primaryGreen },
  coachCard: { backgroundColor: '#1A1A1A', borderRadius: 14, borderWidth: 1, borderColor: '#2A2A2A', padding: 16, marginTop: 12 },
  coachCardActive: { borderColor: COLORS.primaryGreen },
  coachCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dietEmoji: { fontSize: 24 },
  coachRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#444', alignItems: 'center', justifyContent: 'center' },
  coachRadioActive: { borderColor: COLORS.primaryGreen },
  coachRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primaryGreen },
  coachCardLabel: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  coachCardDesc: { color: '#666', fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  targetPreview: { marginTop: 20, backgroundColor: '#1A1A1A', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#2A2A2A' },
  targetPreviewTitle: { color: '#888', fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 12 },
  targetRow: { flexDirection: 'row', justifyContent: 'space-between' },
  targetPill: { alignItems: 'center', flex: 1 },
  targetPillValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  targetPillUnit: { color: '#888', fontSize: 10, fontFamily: 'Inter_400Regular' },
  targetPillLabel: { color: '#555', fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  navRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20, borderTopWidth: 1, borderTopColor: '#1E1E1E' },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1E1E1E', alignItems: 'center', justifyContent: 'center' },
  nextBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.primaryGreen, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { color: '#000', fontSize: 15, fontFamily: 'Inter_700Bold' },
  errorText: { color: '#FF5C5C', fontSize: 13, marginTop: 12, textAlign: 'center' },
});