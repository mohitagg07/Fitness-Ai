import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { authApi, profileApi } from '../../utils/api';
import { actions } from '../../store';

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
      } catch {}
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
    
      console.log('Attempting register to:', process.env.EXPO_PUBLIC_API_URL);
    
      const res = await authApi.register({
    
        full_name: regName.trim(),
    
        email: regEmail.trim(),
    
        password: regPassword,
    
      });
    
      console.log('Register success:', res.data);
    
      const { access_token, user_id } = res.data;
    
      await actions.setAuth(
    
        { id: user_id, email: regEmail.trim(), full_name: regName.trim() },
    
        access_token
    
      );
    
      router.replace('/(tabs)');
  
    } catch (err: any) {
  
      console.log('Register error:', JSON.stringify(err?.response?.data || err?.message));
  
      Alert.alert(
  
        'Registration Failed',
  
        err?.response?.data?.detail
  
        || err?.message
  
        || 'Cannot connect to server. Check backend is running.'
  
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
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <Text style={styles.logo}>💪</Text>
        <Text style={styles.title}>FitAI</Text>
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

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  logo: { fontSize: 52, textAlign: 'center', marginBottom: 8 },
  title: { color: '#FFD700', fontSize: 34, fontWeight: '800', textAlign: 'center', letterSpacing: 2 },
  subtitle: { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 36, letterSpacing: 1 },
  toggle: {
    flexDirection: 'row',
    backgroundColor: '#1E1E1E',
    borderRadius: 14,
    padding: 4,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: '#FFD700' },
  toggleText: { color: '#555', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  toggleTextActive: { color: '#000' },
  form: { gap: 10 },
  label: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 2 },
  input: {
    backgroundColor: '#1E1E1E', borderRadius: 12,
    padding: 15, color: '#FFF', fontSize: 15,
    borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 6,
  },
  btn: {
    backgroundColor: '#FFD700', borderRadius: 14,
    padding: 16, alignItems: 'center', marginTop: 6,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#000', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
});