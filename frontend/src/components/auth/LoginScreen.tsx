import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  Image, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { authApi, profileApi } from '../../utils/api';
import { actions } from '../../store';
import { COLORS } from '../../theme/colors';

// Free-to-use Unsplash photo (Victor Freitas) — purely decorative hero backdrop,
// dimmed by the gradient overlay so it never competes with the form.
const HERO_IMAGE_URL =
  'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=1200&q=80&auto=format&fit=crop';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  const [loading, setLoading] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.login({ email: loginEmail.trim(), password: loginPassword });
      const { access_token, user_id } = res.data;
      await actions.setAuth({ id: user_id, email: loginEmail.trim() }, access_token);
      try {
        const profileRes = await profileApi.getMe();
        const d = profileRes.data;
        actions.setProfile(d.profile || {}, d.injuries || [], d.personal_records || []);
      } catch (profileErr) {
        // Login itself succeeded — don't block entry to the app over a
        // profile fetch failure. But silently eating this previously meant
        // a user could be looking at "Athlete" / empty cards everywhere
        // with no idea why. Log it so it's visible during development;
        // the Dashboard's own error state covers the in-app signal.
        if (__DEV__) {
          console.warn('[Login] Profile fetch failed after login:', profileErr);
        }
      }
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Login Failed', err?.response?.data?.detail || 'Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regName.trim() || !regEmail.trim() || !regPassword.trim()) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (regPassword.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const res = await authApi.register({
        full_name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
      });
      const { access_token, user_id } = res.data;
      await actions.setAuth(
        { id: user_id, email: regEmail.trim(), full_name: regName.trim() },
        access_token
      );
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert(
        'Registration Failed',
        err?.response?.data?.detail || err?.message || 'Cannot connect to server. Check backend is running.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Image source={{ uri: HERO_IMAGE_URL }} style={styles.heroImage} resizeMode="cover" />
      <LinearGradient
        colors={[COLORS.background + 'F2', COLORS.background + 'E6', COLORS.background]}
        style={styles.heroOverlay}
      />
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>

          {/* Logo */}
          <LinearGradient colors={[COLORS.recoveryHigh, COLORS.strain]} style={styles.logoBadge}>
            <Ionicons name="barbell" size={34} color={COLORS.background} />
          </LinearGradient>
          <Text style={styles.title}>NeuroFit AI</Text>
          <Text style={styles.subtitle}>Your AI Gym Spotter</Text>

          {/* Toggle */}
          <View style={styles.toggle}>
            <TouchableOpacity
            style={[styles.toggleBtn, mode === 'login' && styles.toggleBtnActive]}
            onPress={() => setMode('login')}
          >
            <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
              LOG IN
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'register' && styles.toggleBtnActive]}
            onPress={() => setMode('register')}
          >
            <Text style={[styles.toggleText, mode === 'register' && styles.toggleTextActive]}>
              SIGN UP
            </Text>
          </TouchableOpacity>
        </View>

        {/* Login Form */}
        {mode === 'login' && (
          <View style={styles.form}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={loginEmail}
              onChangeText={setLoginEmail}
              placeholder="you@email.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={loginPassword}
              onChangeText={setLoginPassword}
              placeholder="••••••••"
              placeholderTextColor="#555"
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.btnText}>LOG IN</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Register Form */}
        {mode === 'register' && (
          <View style={styles.form}>
            <Text style={styles.label}>FULL NAME</Text>
            <TextInput
              style={styles.input}
              value={regName}
              onChangeText={setRegName}
              placeholder="John Smith"
              placeholderTextColor="#555"
              autoCorrect={false}
            />
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={regEmail}
              onChangeText={setRegEmail}
              placeholder="you@email.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={regPassword}
              onChangeText={setRegPassword}
              placeholder="Min. 8 characters"
              placeholderTextColor="#555"
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.btnText}>CREATE ACCOUNT</Text>}
            </TouchableOpacity>
          </View>
        )}

        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  heroImage: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '48%', opacity: 0.45,
  },
  heroOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '60%',
  },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  logoBadge: {
    width: 76, height: 76, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 14,
    shadowColor: COLORS.recoveryHigh, shadowOpacity: 0.45, shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  title: { color: COLORS.recoveryHigh, fontSize: 34, fontWeight: '800', textAlign: 'center', letterSpacing: 2 },
  subtitle: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 36, letterSpacing: 1 },
  toggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardElevated,
    borderRadius: 14,
    padding: 4,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: COLORS.recoveryHigh },
  toggleText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  toggleTextActive: { color: COLORS.background },
  form: { gap: 10 },
  label: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 2 },
  input: {
    backgroundColor: COLORS.inputBg, borderRadius: 12,
    padding: 15, color: COLORS.text, fontSize: 15,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 6,
  },
  btn: {
    backgroundColor: COLORS.recoveryHigh, borderRadius: 14,
    padding: 16, alignItems: 'center', marginTop: 6,
    shadowColor: COLORS.recoveryHigh, shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: COLORS.background, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
});