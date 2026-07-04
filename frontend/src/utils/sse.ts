// VYRN — minimal Server-Sent-Events client for React Native.
//
// React Native's `fetch` does not reliably expose a readable `response.body`
// stream on all platforms, so this uses XMLHttpRequest instead: its
// `progress` event fires with the response text accumulated so far, which
// lets us diff out only the newly-arrived bytes on every tick and parse
// them as SSE frames (`event: <name>\ndata: <json>\n\n`).

type SSEHandlers = {
  onEvent: (event: string, data: any) => void;
  onError: (err: unknown) => void;
};

type SSEConfig = {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: any;
};

// Splits a raw SSE buffer into whole frames, returning the parsed frames
// plus whatever incomplete trailing text should be carried over to the
// next chunk.
function parseFrames(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: { event: string; data: string }[] = [];

  for (const frame of frames) {
    if (!frame.trim()) continue;
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    events.push({ event, data: dataLines.join('\n') });
  }

  return { events, rest };
}

export function openSSE(config: SSEConfig, handlers: SSEHandlers): () => void {
  const xhr = new XMLHttpRequest();
  let processedLength = 0;
  let buffer = '';
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    xhr.abort();
  };

  xhr.open(config.method || 'GET', config.url, true);
  xhr.setRequestHeader('Accept', 'text/event-stream');
  Object.entries(config.headers || {}).forEach(([key, value]) => {
    xhr.setRequestHeader(key, value);
  });

  const handleChunk = () => {
    const fullText = xhr.responseText || '';
    const newText = fullText.slice(processedLength);
    processedLength = fullText.length;
    if (!newText) return;

    buffer += newText;
    const { events, rest } = parseFrames(buffer);
    buffer = rest;

    for (const { event, data } of events) {
      try {
        const parsed = data ? JSON.parse(data) : null;
        handlers.onEvent(event, parsed);
      } catch {
        handlers.onEvent(event, data);
      }
    }
  };

  xhr.onprogress = handleChunk;

  xhr.onreadystatechange = () => {
    if (xhr.readyState === 4 /* DONE */) {
      handleChunk();
      if (xhr.status < 200 || xhr.status >= 300) {
        if (!closed) handlers.onError(new Error(`SSE request failed with status ${xhr.status}`));
      }
    }
  };

  xhr.onerror = () => {
    if (!closed) handlers.onError(new Error('SSE network error'));
  };

  try {
    xhr.send(config.body !== undefined ? JSON.stringify(config.body) : undefined);
  } catch (err) {
    handlers.onError(err);
  }

  return finish;
}
