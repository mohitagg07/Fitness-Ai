import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authApi } from '../../utils/api';
import { useStore } from '../../store';

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useStore();

  const handleRegister = async () => {
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.register({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
      });
      const { access_token, user_id } = res.data;
      await setAuth({ id: user_id, email: email.trim(), full_name: fullName.trim() }, access_token);
      router.replace('/(tabs)');
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Registration failed.';
      Alert.alert('Error', msg);
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
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={18} color="#FFD700" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Start your AI-coached fitness journey</Text>

        <View style={styles.form}>
          <Text style={styles.label}>FULL NAME</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="John Smith"
            placeholderTextColor="#555"
            autoCorrect={false}
          />

          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            placeholderTextColor="#555"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  inner: { flexGrow: 1, padding: 28, paddingTop: 60 },
  back: { marginBottom: 32, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: '#FFD700', fontSize: 15 },
  title: { color: '#FFF', fontSize: 28, fontWeight: '800', marginBottom: 8 },
  subtitle: { color: '#888', fontSize: 14, marginBottom: 36 },
  form: { gap: 12 },
  label: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  input: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 16,
    color: '#FFF',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 8,
  },
  btn: {
    backgroundColor: '#FFD700',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
});