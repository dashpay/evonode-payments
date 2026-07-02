// Locally-tracked evonodes — persisted in this browser only (localStorage).

import type { Network } from '../types';

const storageKey = (network: Network) => `evonode-payments.tracked.${network}`;

export function loadTracked(network: Network): string[] {
  try {
    const raw = localStorage.getItem(storageKey(network));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveTracked(network: Network, hashes: string[]): void {
  try {
    localStorage.setItem(storageKey(network), JSON.stringify(hashes));
  } catch {
    // Private browsing / quota — tracking just won't persist.
  }
}
