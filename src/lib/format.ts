export const shortHash = (h: string): string => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Platform credits per DASH. */
export const CREDITS_PER_DASH = 100_000_000_000;

export function creditsToDash(credits: bigint | number): number {
  return Number(credits) / CREDITS_PER_DASH;
}

/** Format a credits amount as DASH with sensible precision. */
export function formatDash(credits: bigint | number, digits?: number): string {
  const dash = creditsToDash(credits);
  if (digits === undefined) {
    digits = dash >= 1000 ? 0 : dash >= 10 ? 2 : dash >= 0.01 ? 4 : 6;
  }
  return `${dash.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} DASH`;
}

export function formatCredits(credits: bigint | number): string {
  return `${credits.toLocaleString()} credits`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = ms / 60_000;
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `~${hours.toFixed(1)} h`;
  return `~${(hours / 24).toFixed(1)} d`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
