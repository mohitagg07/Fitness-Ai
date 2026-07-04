// VYRN — Server-Sent Events client for React Native
//
// Why not fetch() + response.body.getReader()? That's the standard web
// approach, but React Native's fetch polyfill does not expose a readable
// stream body — response.body is undefined on Hermes/RN today. The
// approach that *does* work on RN (and is what libraries like
// react-native-sse use under the hood) is a plain XMLHttpRequest with the
// 'progress' event: RN's XHR implementation delivers `xhr.responseText`
// incrementally as bytes arrive, even though the request hasn't finished.
// This client reads that growing string, extracts any newly-arrived
// complete "event:...\ndata:...\n\n" frames, and parses them incrementally.
export interface SSEHandlers {
  onEvent: (event: string, data: any) => void;
  onError?: (err: any) => void;
  onOpen?: () => void;
}

export interface SSERequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: any;
}

export function openSSE(req: SSERequest, handlers: SSEHandlers): () => void {
  const xhr = new XMLHttpRequest();
  let processedLength = 0;
  let aborted = false;

  xhr.open(req.method || 'POST', req.url, true);
  Object.entries(req.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
  xhr.setRequestHeader('Accept', 'text/event-stream');

  let buffer = '';

  function processNewData() {
    const full = xhr.responseText || '';
    if (full.length <= processedLength) return;
    const newChunk = full.slice(processedLength);
    processedLength = full.length;
    buffer += newChunk;

    // SSE frames are separated by a blank line ("\n\n").
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (data) {
        try {
          handlers.onEvent(event, JSON.parse(data));
        } catch {
          handlers.onEvent(event, data);
        }
      }
    }
  }

  xhr.onreadystatechange = () => {
    if (aborted) return;
    if (xhr.readyState === xhr.HEADERS_RECEIVED) {
      if (xhr.status >= 200 && xhr.status < 300) {
        handlers.onOpen?.();
      } else {
        handlers.onError?.(new Error(`SSE request failed with status ${xhr.status}`));
      }
    }
  };

  // @ts-ignore — 'progress' fires repeatedly as new bytes land; RN's XHR
  // supports this even for a still-open (streaming) response.
  xhr.onprogress = () => {
    if (aborted) return;
    if (xhr.status >= 200 && xhr.status < 300) processNewData();
  };

  xhr.onerror = () => { if (!aborted) handlers.onError?.(new Error('Network error during stream')); };
  xhr.onload = () => { if (!aborted) processNewData(); };

  xhr.send(req.body != null ? JSON.stringify(req.body) : undefined);

  return () => {
    aborted = true;
    xhr.abort();
  };
}