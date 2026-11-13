/**
 * Platform integration for the native shells.
 *  - Mobile (CALCI-M): Capacitor injects window.Capacitor; we talk to native
 *    plugins through its bridge without bundling plugin packages.
 *  - Desktop (CALCI-D): Electron preload exposes window.calciDesktop.
 * On the plain web every helper degrades gracefully.
 */

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
      nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<any>;
      Plugins?: Record<string, any>;
    };
    calciDesktop?: {
      platform: string;
      version: string;
      setAlwaysOnTop: (on: boolean) => Promise<boolean>;
      isAlwaysOnTop: () => Promise<boolean>;
      setTitleBarTheme: (theme: 'light' | 'dark') => void;
      openExternal: (url: string) => void;
    };
  }
}

const env = import.meta.env as Record<string, string | undefined>;

/** Public web origin used for share links, embed snippets and API calls. */
export const PUBLIC_ORIGIN: string = env.VITE_PUBLIC_ORIGIN || (typeof location !== 'undefined' && /^https?:/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) ? location.origin : 'https://calci-web.vercel.app');

/** Base for API requests: same-origin on the web (works in dev too), the public host in native shells. */
export const API_BASE: string = env.VITE_NATIVE ? PUBLIC_ORIGIN : '';

export const isCapacitor = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
export const isDesktop = typeof window !== 'undefined' && !!window.calciDesktop;
export const isNative = isCapacitor || isDesktop || !!env.VITE_NATIVE;

function callNative(plugin: string, method: string, options?: unknown): Promise<any> | undefined {
  const cap = window.Capacitor;
  if (!cap) return undefined;
  try {
    if (cap.nativePromise) return cap.nativePromise(plugin, method, options).catch(() => undefined);
    const p = cap.Plugins?.[plugin];
    if (p?.[method]) return Promise.resolve(p[method](options)).catch(() => undefined);
  } catch {
    /* plugin unavailable */
  }
  return undefined;
}

export function nativeHaptic(style: 'LIGHT' | 'MEDIUM' | 'HEAVY' = 'LIGHT'): boolean {
  if (!isCapacitor) return false;
  callNative('Haptics', 'impact', { style });
  return true;
}

export function syncNativeTheme(theme: 'light' | 'dark', background: string) {
  if (isCapacitor) {
    callNative('StatusBar', 'setStyle', { style: theme === 'dark' ? 'DARK' : 'LIGHT' });
    callNative('StatusBar', 'setBackgroundColor', { color: background });
  }
  window.calciDesktop?.setTitleBarTheme(theme);
}

export function initNative() {
  if (window.calciDesktop) document.documentElement.dataset.desktop = window.calciDesktop.platform;
  if (isCapacitor) document.documentElement.dataset.mobile = window.Capacitor?.getPlatform?.() ?? 'native';
  if (!isCapacitor) return;
  callNative('SplashScreen', 'hide', {});
  const app = window.Capacitor?.Plugins?.App;
  try {
    app?.addListener?.('backButton', (e: { canGoBack?: boolean }) => {
      const overlay = document.querySelector('.overlay');
      if (overlay) {
        (overlay as HTMLElement).click();
        return;
      }
      if (history.length > 1 && e?.canGoBack !== false) history.back();
      else callNative('App', 'minimizeApp', {}) ?? callNative('App', 'exitApp', {});
    });
  } catch {
    /* ignore */
  }
}

export function openExternal(url: string) {
  if (window.calciDesktop) window.calciDesktop.openExternal(url);
  else if (isCapacitor) callNative('Browser', 'open', { url }) ?? window.open(url, '_blank');
  else window.open(url, '_blank', 'noopener');
}
