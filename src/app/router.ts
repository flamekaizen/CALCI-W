import { useEffect, useState } from 'react';
import { MODES } from './modes';

export interface Route {
  mode: string;
  embed: boolean;
  params: URLSearchParams;
}

function parse(): Route {
  const parts = location.pathname.split('/').filter(Boolean);
  const embed = parts[0] === 'embed';
  const id = embed ? parts[1] : parts[0];
  const mode = MODES.some((m) => m.id === id) ? id! : 'scientific';
  return { mode, embed, params: new URLSearchParams(location.search) };
}

const listeners = new Set<() => void>();

export function navigate(mode: string, opts: { replace?: boolean; search?: string } = {}) {
  const r = parse();
  const path = `${r.embed ? '/embed' : ''}/${mode}${opts.search ?? (r.embed ? location.search : '')}`;
  if (location.pathname + location.search === path) return;
  if (opts.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  listeners.forEach((l) => l());
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const update = () => setRoute(parse());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return route;
}

export const currentRoute = parse;

// Native shells (desktop menus, shortcuts) can switch modes without a reload:
//   window.dispatchEvent(new CustomEvent('calci:navigate', { detail: 'graph' }))
if (typeof window !== 'undefined') {
  window.addEventListener('calci:navigate', (e) => {
    const mode = (e as CustomEvent<string>).detail;
    if (MODES.some((m) => m.id === mode)) navigate(mode);
  });
}
