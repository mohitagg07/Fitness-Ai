// VYRN — minimal Server-Sent-Events client for React Native.
//
// React Native does not consistently expose a readable fetch response
// stream on every supported runtime. XMLHttpRequest gives us incremental
// responseText updates, which are parsed into complete SSE frames here.

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

type SSEFrame = { event: string; data: string };

function parseFrames(buffer: string): { events: SSEFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const frames = normalized.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: SSEFrame[] = [];

  for (const frame of frames) {
    if (!frame.trim() || frame.startsWith(':')) continue;
    let event = 'message';
    const dataLines: string[] = [];

    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }

    if (dataLines.length) events.push({ event, data: dataLines.join('\n') });
  }

  return { events, rest };
}

export function openSSE(config: SSEConfig, handlers: SSEHandlers): () => void {
  const xhr = new XMLHttpRequest();
  let processedLength = 0;
  let buffer = '';
  let closed = false;
  let sawDoneEvent = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    xhr.abort();
  };

  const fail = (error: unknown) => {
    if (closed) return;
    closed = true;
    xhr.abort();
    handlers.onError(error);
  };

  const dispatch = (events: SSEFrame[]) => {
    for (const frame of events) {
      if (closed) return;
      let data: any = frame.data;
      if (frame.data) {
        try {
          data = JSON.parse(frame.data);
        } catch {
          // Plain-text SSE payloads are valid; preserve them as text.
        }
      }
      if (frame.event === 'done') sawDoneEvent = true;
      try {
        handlers.onEvent(frame.event, data);
      } catch (error) {
        fail(error);
        return;
      }
    }
  };

  const handleChunk = (flush = false) => {
    if (closed) return;
    const fullText = xhr.responseText || '';
    const newText = fullText.slice(processedLength);
    processedLength = fullText.length;
    if (newText) buffer += newText;

    const parsed = parseFrames(flush ? `${buffer}\n\n` : buffer);
    buffer = flush ? '' : parsed.rest;
    dispatch(parsed.events);
  };

  xhr.open(config.method || 'GET', config.url, true);
  xhr.setRequestHeader('Accept', 'text/event-stream');
  Object.entries(config.headers || {}).forEach(([key, value]) => {
    xhr.setRequestHeader(key, value);
  });

  xhr.onprogress = () => handleChunk();
  xhr.onreadystatechange = () => {
    if (xhr.readyState !== 4 || closed) return;

    handleChunk(true);
    if (closed) return;

    if (xhr.status < 200 || xhr.status >= 300) {
      fail(new Error(`SSE request failed with status ${xhr.status}`));
    } else if (!sawDoneEvent) {
      fail(new Error('SSE connection closed before the coach finished the response.'));
    } else {
      closed = true;
    }
  };
  xhr.onerror = () => fail(new Error('SSE network error'));
  xhr.ontimeout = () => fail(new Error('SSE request timed out'));

  try {
    xhr.send(config.body !== undefined ? JSON.stringify(config.body) : undefined);
  } catch (error) {
    fail(error);
  }

  return finish;
}