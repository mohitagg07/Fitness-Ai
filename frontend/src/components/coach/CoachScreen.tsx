import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { coachApi } from '../../utils/api';
import { useStore } from '../../store';

const SUGGESTIONS = [
  "Give me today's chest workout",
  "I deadlifted 150kg x 3 with straps, RPE 9",
  "Only 30 minutes today, what can I do?",
  "My shoulder is clicking today",
  "How's my CNS fatigue looking?",
];

export default function CoachScreen() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const { chatHistory, addChatMessage, setCnsFatigue, activeSession } = useStore();

  const sendMessage = async (text?: string) => {
    const message = text || input.trim();
    if (!message) return;

    setInput('');
    addChatMessage('user', message);
    setLoading(true);

    try {
      const res = await coachApi.chat(message, activeSession?.id);
      const data = res.data;

      addChatMessage('assistant', data.reply);

      if (data.cns_fatigue_score !== null) {
        setCnsFatigue(data.cns_fatigue_score);
      }

      // Emergency modal
      if (data.emergency) {
        Alert.alert('⚠️ Workout Terminated', 'Injury signal detected. See the message below for R.I.C.E protocol.', [{ text: 'Understood' }]);
      }
    } catch (err: any) {
      addChatMessage('assistant', 'Connection error. Check your network and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (chatHistory.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chatHistory.length]);

  const renderMessage = ({ item }: { item: any }) => (
    <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.aiBubble]}>
      {item.role === 'assistant' && (
        <Text style={styles.roleLabel}>🦅 FITAI COACH</Text>
      )}
      <Text style={[styles.messageText, item.role === 'user' && styles.userText]}>
        {item.content}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Chat History */}
      {chatHistory.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>What's the move today?</Text>
          <Text style={styles.emptySubtitle}>Tell me what you're feeling, what you lifted, or what you need.</Text>
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s, i) => (
              <TouchableOpacity key={i} style={styles.suggestion} onPress={() => sendMessage(s)}>
                <Text style={styles.suggestionText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={chatHistory}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#FFD700" size="small" />
          <Text style={styles.loadingText}>Coach thinking...</Text>
        </View>
      )}

      {/* Input Bar */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Tell me what you lifted, or ask anything..."
          placeholderTextColor="#666"
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={() => sendMessage()}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => sendMessage()}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.sendIcon}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  messageList: { padding: 16, paddingBottom: 8 },
  bubble: {
    marginBottom: 12,
    borderRadius: 16,
    padding: 14,
    maxWidth: '90%',
  },
  userBubble: {
    backgroundColor: '#1E3A5F',
    alignSelf: 'flex-end',
  },
  aiBubble: {
    backgroundColor: '#1E1E1E',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  roleLabel: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  messageText: { color: '#E8E8E8', fontSize: 15, lineHeight: 22 },
  userText: { color: '#FFFFFF' },
  emptyState: { flex: 1, padding: 24, justifyContent: 'center' },
  emptyTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: '#888', fontSize: 14, marginBottom: 24, lineHeight: 20 },
  suggestions: { gap: 8 },
  suggestion: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  suggestionText: { color: '#C0C0C0', fontSize: 13 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 10,
  },
  loadingText: { color: '#FFD700', fontSize: 13 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#252525',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    color: '#FFFFFF',
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: '#FFD700',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#333' },
  sendIcon: { color: '#000', fontSize: 18, fontWeight: '700' },
});
