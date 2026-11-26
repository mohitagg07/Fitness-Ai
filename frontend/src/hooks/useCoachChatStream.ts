// VYRN — resilient coach chat transport
//
// The API currently returns the completed coach result as SSE chunks. The
// UI reveals those chunks progressively, but this is not model-token
// streaming. Keep transport state here so the screen cannot get stranded in
// a permanent "thinking" state after an auth, storage, or network failure.
import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '../utils/storage';
import { API_BASE } from '../utils/config';
import { openSSE } from '../utils/sse';

export interface StreamDonePayload {
  reply: string;
  guardrails_triggered: string[];
  emergency: boolean;
  cns_fatigue_score: number | null;
  workout_blocks: any;
  structured_decision: any;
}

interface UseCoachChatStreamOptions {
  onDone: (payload: StreamDonePayload) => void;
  onError: (message: string) => void;
}

const CONNECTION_ERROR = 'Connection lost while VYRN was replying. Please try again.';

export function useCoachChatStream({ onDone, onError }: UseCoachChatStreamOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const closeRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const finishRequest = useCallback((requestId: number) => {
    if (requestIdRef.current !== requestId) return;
    activeRef.current = false;
    closeRef.current?.();
    closeRef.current = null;
    if (mountedRef.current) setIsStreaming(false);
  }, []);

  const send = useCallback(async (content: string, sessionId?: string) => {
    const message = content.trim();
    if (!message || activeRef.current) return;

    const requestId = ++requestIdRef.current;
    activeRef.current = true;
    setIsStreaming(true);
    setStreamingText('');

    try {
      const token = await storage.getItem('vyrn_token');
      if (requestIdRef.current !== requestId || !activeRef.current) return;

      if (!token) {
        finishRequest(requestId);
        onError('Your session has expired. Please sign in again.');
        return;
      }

      const close = openSSE(
        {
          url: `${API_BASE}/coach/chat/stream`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: { content: message, session_id: sessionId },
        },
        {
          onEvent: (event, data) => {
            if (requestIdRef.current !== requestId || !activeRef.current) return;

            if (event === 'chunk') {
              const text = typeof data?.text === 'string' ? data.text : '';
              if (text) setStreamingText((prev) => prev + text);
              return;
            }

            if (event === 'done') {
              finishRequest(requestId);
              onDone(data as StreamDonePayload);
              return;
            }

            if (event === 'error') {
              finishRequest(requestId);
              onError(typeof data?.detail === 'string' ? data.detail : CONNECTION_ERROR);
            }
          },
          onError: () => {
            if (requestIdRef.current !== requestId || !activeRef.current) return;
            finishRequest(requestId);
            onError(CONNECTION_ERROR);
          },
        }
      );

      // If the request was cancelled synchronously while opening, close it
      // instead of retaining a live XHR after the caller has moved on.
      if (requestIdRef.current !== requestId || !activeRef.current) close();
      else closeRef.current = close;
    } catch (error) {
      if (requestIdRef.current !== requestId || !activeRef.current) return;
      finishRequest(requestId);
      onError(error instanceof Error && error.message
        ? error.message
        : 'VYRN could not start the reply. Please try again.');
    }
  }, [finishRequest, onDone, onError]);

  const cancel = useCallback(() => {
    requestIdRef.current += 1;
    activeRef.current = false;
    closeRef.current?.();
    closeRef.current = null;
    setIsStreaming(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      activeRef.current = false;
      closeRef.current?.();
      closeRef.current = null;
    };
  }, []);

  return { send, cancel, isStreaming, streamingText };
}