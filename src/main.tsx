import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import App from './app/App';

// Apply the saved theme before first paint to avoid a flash.
try {
  const saved = JSON.parse(localStorage.getItem('calci-state-v1') ?? '{}')?.state;
  const theme = saved?.theme ?? 'system';
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (saved?.accent) document.documentElement.dataset.accent = saved.accent;
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support (registered only in production builds and not inside embeds or native shells).
if (import.meta.env.PROD && 'serviceWorker' in navigator && !location.pathname.startsWith('/embed') && location.protocol === 'https:') {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}
