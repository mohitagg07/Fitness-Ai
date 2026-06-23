import { Platform } from 'react-native';

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const w = window as any;
  w.__bootError = null;

  const renderBootError = (text: string) => {
    if (document.getElementById('__boot_error_overlay')) return;
    const el = document.createElement('div');
    el.id = '__boot_error_overlay';
    Object.assign(el.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '999999',
      background: '#0a0a0a', color: '#ff5555', fontFamily: 'monospace',
      fontSize: '13px', whiteSpace: 'pre-wrap', padding: '20px',
      maxHeight: '100vh', overflowY: 'auto',
    });
    el.textContent = 'BOOT ERROR (caught before/outside React):\n\n' + text;
    document.body.appendChild(el);
  };

  window.addEventListener('error', (e) => {
    w.__bootError = (e.error && e.error.stack) || e.message || String(e);
    renderBootError(w.__bootError);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    w.__bootError = (reason && reason.stack) || (reason && reason.message) || String(reason);
    renderBootError(w.__bootError);
  });

  setTimeout(() => {
    const root = document.getElementById('root');
    if (root && root.children.length === 0 && !w.__bootError) {
      renderBootError(
        'Nothing rendered into #root after 8 seconds, and no JS error was ' +
        'thrown or caught anywhere.'
      );
    }
  }, 8000);
}

export {};