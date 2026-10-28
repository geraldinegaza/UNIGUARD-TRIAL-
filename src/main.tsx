import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { logClientError } from './services/repo';

// Unexpected errors go to the client error log (signed-in sessions only).
// Network failures are expected in a disaster and are not errors in the app.
const isNetwork = (m: string) => /fetch|network|load failed|offline/i.test(m);
window.addEventListener('error', (e) => {
  const m = e.message || String(e.error || '');
  if (!isNetwork(m)) logClientError(m, { source: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  const m = (e.reason && (e.reason.message || String(e.reason))) || '';
  if (!isNetwork(m)) logClientError(m, { kind: 'unhandledrejection' });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
