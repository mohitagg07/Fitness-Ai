// VYRN — streaming coach chat
//
// PERF + UX: CoachScreen previously did one axios POST, then dumped the
// entire reply into the message list the instant the whole response
// arrived — meaning a multi-second "typing…" spinner followed by the
// full paragraph appearing all at once. This hook instead connects to
// POST /api/coach/chat/stream (see backend/api/routes/coach.py) over SSE
// and exposes a `streamingText` value that grows chunk-by-chunk, so
// CoachScreen can render it live as a normal chat bubble that's still
// being "typed" — the user sees progress within a couple hundred
// milliseconds of sending, not the full multi-second round trip.
//
// The input box, send button, and rest of the screen stay fully
// interactive throughout — nothing here blocks the JS thread or gates
// navigation; `isStreaming` is just a boolean a screen can use to
// disable double-sends, exactly like the old `loading` flag.
import { useCallback, useRef, useState } from 'react';
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

export function useCoachChatStream({ onDone, onError }: UseCoachChatStreamOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const closeRef = useRef<(() => void) | null>(null);

  const send = useCallback(async (content: string, sessionId?: string) => {
    setIsStreaming(true);
    setStreamingText('');

    const token = await storage.getItem('vyrn_token');

    closeRef.current = openSSE(
      {
        url: `${API_BASE}/coach/chat/stream`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: { content, session_id: sessionId },
      },
      {
        onEvent: (event, data) => {
          if (event === 'chunk') {
            setStreamingText((prev) => prev + data.text);
          } else if (event === 'done') {
            setIsStreaming(false);
            onDone(data as StreamDonePayload);
          } else if (event === 'error') {
            setIsStreaming(false);
            onError(data?.detail || 'Something went wrong. Please try again.');
          }
        },
        onError: () => {
          setIsStreaming(false);
          onError('Connection lost while VYRN was replying. Please try again.');
        },
      }
    );
  }, [onDone, onError]);

  const cancel = useCallback(() => {
    closeRef.current?.();
    setIsStreaming(false);
  }, []);

  return { send, cancel, isStreaming, streamingText };
}