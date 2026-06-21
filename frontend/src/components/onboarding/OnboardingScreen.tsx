import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { profileApi } from '../../utils/api';
import { actions } from '../../store';
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
  food_preference: string | null;
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
  food_preference: null,
  coach_style: null,
};

// Four condensed slides covering every required OnboardingCreate field plus
// the highest-value optional ones. The backend model has 15+ fields across
// the original 8-slide spec; thinning that to 8 near-empty screens would be
// worse UX than 4 well-paced ones, so slides group related fields together.
const SLIDE_COUNT = 4;

function isSlideValid(slide: number, form: FormState): boolean {
  switch (slide) {
    case 0:
      return form.full_name.trim().length > 0 && !!form.age && !!form.gender;
    case 1:
      return !!form.height_cm && !!form.weight_kg && !!form.goal;
    case 2:
      return !!form.experience_level && !!form.gym_or_home;
    case 3:
      return !!form.coach_style;
    default:
      return false;
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
    ringProgress.value = withTiming((index + 1) / SLIDE_COUNT, { duration: 450 });
  };

  const handleNext = async () => {
    if (!isSlideValid(slide, form)) {
      setError('Please fill in everything on this screen before continuing.');
      return;
    }
    setError(null);

    if (slide < SLIDE_COUNT - 1) {
      goToSlide(slide + 1);
      return;
    }

    // Final slide — submit to the backend.
    setSubmitting(true);
    try {
      const res = await profileApi.onboard({
        full_name: form.full_name.trim(),
        age: Number(form.age),
        gender: form.gender,
        height_cm: Number(form.height_cm),
        weight_kg: Number(form.weight_kg),
        target_weight_kg: form.target_weight_kg ? Number(form.target_weight_kg) : undefined,
        goal: form.goal,
        experience_level: form.experience_level,
        gym_or_home: form.gym_or_home,
        workout_days_per_week: form.workout_days_per_week,
        food_preference: form.food_preference ?? undefined,
        coach_style: form.coach_style,
      });
      // Previously the store was never updated here, so the Dashboard
      // (which reads profile.goal / profile.full_name from the store, not
      // from a fetch of its own) showed stale/empty values immediately
      // after onboarding until some other screen happened to call
      // profileApi.getMe(). The /onboard endpoint already returns the
      // saved row — use it directly instead of waiting on a second round trip.
      actions.setProfile(res.data || {}, [], []);
      router.replace('/(tabs)');
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(
        typeof detail === 'string'
          ? detail
          : 'Something went wrong saving your profile. Check your connection and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    if (slide === 0) return;
    goToSlide(slide - 1);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
      >
        <View style={[styles.slide, { width: SCREEN_W }]}>
          <SlideWelcome form={form} setForm={setForm} />
        </View>
        <View style={[styles.slide, { width: SCREEN_W }]}>
          <SlideBody form={form} setForm={setForm} />
        </View>
        <View style={[styles.slide, { width: SCREEN_W }]}>
          <SlideTraining form={form} setForm={setForm} />
        </View>
        <View style={[styles.slide, { width: SCREEN_W }]}>
          <SlideCoach form={form} setForm={setForm} />
        </View>
      </ScrollView>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.footer}>
        <View style={styles.dots}>
          {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
            <View key={i} style={[styles.dot, i === slide && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.controlsRow}>
          <Pressable
            onPress={handleBack}
            disabled={slide === 0}
            style={[styles.backButton, slide === 0 && styles.backButtonHidden]}
          >
            <Ionicons name="chevron-back" size={22} color="#9AA5B1" />
          </Pressable>

          <ProgressRing progress={(slide + 1) / SLIDE_COUNT}>
            <Pressable onPress={handleNext} disabled={submitting} style={styles.nextButton}>
              {submitting ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <Ionicons
                  name={slide === SLIDE_COUNT - 1 ? 'checkmark' : 'arrow-forward'}
                  size={26}
                  color="#0A0A0A"
                />
              )}
            </Pressable>
          </ProgressRing>

          <View style={styles.backButtonHidden} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Circular progress ring, recreated from the Flutter reference's
// CircularPercentIndicator pattern using react-native-svg + Reanimated. ───
function ProgressRing({
  progress,
  children,
}: {
  progress: number;
  children: React.ReactNode;
}) {
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <View style={styles.ringWrap}>
      <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke="#2A2A2A"
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={COLORS.primaryGreen}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

// ─── Slide 1: Welcome (name, age, gender) ──────────────────────────────────
function SlideWelcome({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <View style={styles.slideContent}>
      <Text style={styles.slideTitle}>Welcome.</Text>
      <Text style={styles.slideSubtitle}>Let's set up your AI fitness agent.</Text>

      <Text style={styles.label}>Your name</Text>
      <TextInput
        style={styles.input}
        placeholder="Full name"
        placeholderTextColor="#666"
        value={form.full_name}
        onChangeText={(v) => setForm((f) => ({ ...f, full_name: v }))}
      />

      <Text style={styles.label}>Age</Text>
      <TextInput
        style={styles.input}
        placeholder="Age"
        placeholderTextColor="#666"
        keyboardType="number-pad"
        value={form.age}
        onChangeText={(v) => setForm((f) => ({ ...f, age: v.replace(/[^0-9]/g, '') }))}
      />

      <Text style={styles.label}>Gender</Text>
      <SelectRow
        options={[
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
          { value: 'other', label: 'Other' },
        ]}
        selected={form.gender}
        onSelect={(v) => setForm((f) => ({ ...f, gender: v as Gender }))}
      />
    </View>
  );
}

// ─── Slide 2: Body metrics + goal ──────────────────────────────────────────
function SlideBody({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <View style={styles.slideContent}>
      <Text style={styles.slideTitle}>Your body.</Text>
      <Text style={styles.slideSubtitle}>This drives your calorie and macro targets.</Text>

      <View style={styles.row2}>
        <View style={styles.col}>
          <Text style={styles.label}>Height (cm)</Text>
          <TextInput
            style={styles.input}
            placeholder="175"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            value={form.height_cm}
            onChangeText={(v) => setForm((f) => ({ ...f, height_cm: v.replace(/[^0-9.]/g, '') }))}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Weight (kg)</Text>
          <TextInput
            style={styles.input}
            placeholder="75"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            value={form.weight_kg}
            onChangeText={(v) => setForm((f) => ({ ...f, weight_kg: v.replace(/[^0-9.]/g, '') }))}
          />
        </View>
      </View>

      <Text style={styles.label}>Target weight (kg) — optional</Text>
      <TextInput
        style={styles.input}
        placeholder="70"
        placeholderTextColor="#666"
        keyboardType="decimal-pad"
        value={form.target_weight_kg}
        onChangeText={(v) => setForm((f) => ({ ...f, target_weight_kg: v.replace(/[^0-9.]/g, '') }))}
      />

      <Text style={styles.label}>Goal</Text>
      <SelectRow
        options={[
          { value: 'cut', label: 'Fat Loss' },
          { value: 'bulk', label: 'Muscle Gain' },
          { value: 'recomp', label: 'Recomposition' },
          { value: 'maintain', label: 'Maintenance' },
        ]}
        selected={form.goal}
        onSelect={(v) => setForm((f) => ({ ...f, goal: v as Goal }))}
        wrap
      />
    </View>
  );
}

// ─── Slide 3: Training setup ────────────────────────────────────────────
function SlideTraining({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <View style={styles.slideContent}>
      <Text style={styles.slideTitle}>Training.</Text>
      <Text style={styles.slideSubtitle}>Your Workout Agent uses this to build your plan.</Text>

      <Text style={styles.label}>Experience level</Text>
      <SelectRow
        options={[
          { value: 'beginner', label: 'Beginner' },
          { value: 'intermediate', label: 'Intermediate' },
          { value: 'advanced', label: 'Advanced' },
          { value: 'elite', label: 'Elite' },
        ]}
        selected={form.experience_level}
        onSelect={(v) => setForm((f) => ({ ...f, experience_level: v as Experience }))}
        wrap
      />

      <Text style={styles.label}>Where do you train?</Text>
      <SelectRow
        options={[
          { value: 'home', label: 'Home' },
          { value: 'gym', label: 'Gym' },
          { value: 'hybrid', label: 'Hybrid' },
        ]}
        selected={form.gym_or_home}
        onSelect={(v) => setForm((f) => ({ ...f, gym_or_home: v as Location }))}
      />

      <Text style={styles.label}>Days per week: {form.workout_days_per_week}</Text>
      <View style={styles.stepperRow}>
        {[2, 3, 4, 5, 6, 7].map((d) => (
          <Pressable
            key={d}
            onPress={() => setForm((f) => ({ ...f, workout_days_per_week: d }))}
            style={[styles.stepperPill, form.workout_days_per_week === d && styles.stepperPillActive]}
          >
            <Text
              style={[
                styles.stepperText,
                form.workout_days_per_week === d && styles.stepperTextActive,
              ]}
            >
              {d}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Slide 4: Diet preference + coach style ─────────────────────────────
function SlideCoach({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <View style={styles.slideContent}>
      <Text style={styles.slideTitle}>Almost there.</Text>
      <Text style={styles.slideSubtitle}>How should your AI Coach talk to you?</Text>

      <Text style={styles.label}>Diet preference — optional</Text>
      <SelectRow
        options={[
          { value: 'non-veg', label: 'Non-Veg' },
          { value: 'veg', label: 'Vegetarian' },
          { value: 'vegan', label: 'Vegan' },
          { value: 'eggetarian', label: 'Eggetarian' },
        ]}
        selected={form.food_preference}
        onSelect={(v) => setForm((f) => ({ ...f, food_preference: v }))}
        wrap
      />

      <Text style={styles.label}>Coach style</Text>
      <SelectRow
        options={[
          { value: 'friendly', label: 'Friendly' },
          { value: 'strict', label: 'Strict' },
          { value: 'military', label: 'Military' },
        ]}
        selected={form.coach_style}
        onSelect={(v) => setForm((f) => ({ ...f, coach_style: v as CoachStyle }))}
      />
    </View>
  );
}

// ─── Shared pill-select control ─────────────────────────────────────────
function SelectRow({
  options,
  selected,
  onSelect,
  wrap,
}: {
  options: { value: string; label: string }[];
  selected: string | null;
  onSelect: (v: string) => void;
  wrap?: boolean;
}) {
  return (
    <View style={[styles.selectRow, wrap && styles.selectRowWrap]}>
      {options.map((opt) => (
        <Pressable
          key={opt.value}
          onPress={() => onSelect(opt.value)}
          style={[styles.pill, selected === opt.value && styles.pillActive]}
        >
          <Text style={[styles.pillText, selected === opt.value && styles.pillTextActive]}>
            {opt.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  pager: { flex: 1 },
  slide: { flex: 1 },
  slideContent: { flex: 1, paddingHorizontal: 24, paddingTop: 64 },
  slideTitle: { fontSize: 30, fontWeight: '800', color: '#E8ECEF' },
  slideSubtitle: { fontSize: 14, color: '#9AA5B1', marginTop: 6, marginBottom: 28 },
  label: { fontSize: 12, fontWeight: '600', color: '#9AA5B1', marginBottom: 8, marginTop: 18, letterSpacing: 0.5 },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#E8ECEF',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  row2: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  selectRow: { flexDirection: 'row', gap: 10 },
  selectRowWrap: { flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  pillActive: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  pillText: { color: '#9AA5B1', fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: '#0A0A0A' },
  stepperRow: { flexDirection: 'row', gap: 8 },
  stepperPill: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center',
  },
  stepperPillActive: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  stepperText: { color: '#9AA5B1', fontWeight: '700' },
  stepperTextActive: { color: '#0A0A0A' },
  errorBanner: {
    marginHorizontal: 24, marginBottom: 8,
    backgroundColor: '#2A1414', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#5C2424',
  },
  errorText: { color: '#F25252', fontSize: 13 },
  footer: { paddingHorizontal: 24, paddingBottom: 28, paddingTop: 8 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2A2A2A' },
  dotActive: { backgroundColor: COLORS.primaryGreen, width: 18 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1A1A1A',
  },
  backButtonHidden: { opacity: 0, width: 44, height: 44 },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  nextButton: {
    width: RING_SIZE - 20, height: RING_SIZE - 20, borderRadius: (RING_SIZE - 20) / 2,
    backgroundColor: COLORS.primaryGreen,
    alignItems: 'center', justifyContent: 'center',
  },
});