import { useSyncExternalStore } from 'react';

export const STATUS_REFRESH_KEY = 'codex-switch.codex-status.refresh-minutes';
export const DEFAULT_REFRESH_MINUTES = 5;
export const MIN_REFRESH_MINUTES = 1;
export const MAX_REFRESH_MINUTES = 60;
const CHANGE_EVENT = 'codex-switch.codex-status.preferences';
let fallback = DEFAULT_REFRESH_MINUTES;

export function refreshMinutes(value: number) {
  return Number.isInteger(value) && value >= MIN_REFRESH_MINUTES && value <= MAX_REFRESH_MINUTES
    ? value : DEFAULT_REFRESH_MINUTES;
}

function read() {
  try {
    const value = localStorage.getItem(STATUS_REFRESH_KEY);
    return value === null ? DEFAULT_REFRESH_MINUTES : refreshMinutes(Number(value));
  } catch { return fallback; }
}

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function saveStatusRefreshMinutes(value: number) {
  fallback = refreshMinutes(value);
  try { localStorage.setItem(STATUS_REFRESH_KEY, String(fallback)); }
  catch { /* Restricted storage retains the preference for this session. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useStatusRefreshMinutes() {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_REFRESH_MINUTES);
}
