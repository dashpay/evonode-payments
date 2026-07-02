import type { DashboardData, NodeRow, ProposalEta } from '../types';

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

const dashNum = (credits: number | bigint, digits = 2): string =>
  creditsToDash(credits).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

// --- next-proposal display (blocks + quorum changes, time only as info) ------

/** Blocks left until the node's slot, ticking down locally as the chain advances. */
export function etaRemainingBlocks(eta: ProposalEta, data: DashboardData, now: number): number {
  const elapsedBlocks = Math.floor(Math.max(0, now - data.fetchedAt) / data.avgBlockTimeMs);
  return Math.max(0, eta.blocks - elapsedBlocks);
}

export function etaLabel(eta: ProposalEta, data: DashboardData, now: number): string {
  const blocks = etaRemainingBlocks(eta, data, now);
  return `~${blocks.toLocaleString()} blk · ${eta.rotations} rot`;
}

export function etaTooltip(eta: ProposalEta, data: DashboardData, now: number): string {
  const blocks = etaRemainingBlocks(eta, data, now);
  const remainingMs = blocks * data.avgBlockTimeMs;
  return [
    `~${blocks.toLocaleString()} blocks until this node's proposal slot,`,
    `after ${eta.rotations} validator-set rotation${eta.rotations === 1 ? '' : 's'} (quorum changes).`,
    `≈ ${formatDuration(remainingMs)} at ${(data.avgBlockTimeMs / 1000).toFixed(1)}s/block → ${formatDateTime(now + remainingMs)}.`,
    'Estimated by walking the current quorum rotation; DKG churn shifts the schedule.',
  ].join('\n');
}

// --- est-monthly breakdown tooltips -----------------------------------------

function coreLines(row: Pick<NodeRow, 'estMonthlyCoreCredits' | 'status' | 'registered'>, data: DashboardData): string[] {
  const core = data.coreNetwork;
  if (!core) {
    return ['Core payment queue: unavailable (masternode-count source unreachable).'];
  }
  if (!row.registered || row.status !== 'ENABLED') {
    return [
      `Core payment queue: 0 — node is ${row.registered ? (row.status ?? 'not enabled').toLowerCase() : 'no longer registered'}, so it does not advance in the queue.`,
    ];
  }
  return [
    `Core payment queue: ${dashNum(row.estMonthlyCoreCredits)} DASH/mo`,
    `· evonodes are paid 4 consecutive blocks per queue cycle;`,
    `  queue = ${core.enabledRegular.toLocaleString()} regular + 4 × ${core.enabledEvonodes.toLocaleString()} evonodes = ${core.paymentQueueWeight.toLocaleString()} blocks`,
    `· ≈ ${core.evonodePaymentsPerMonth.toFixed(1)} paid blocks/mo × ${dashNum(core.l1PayoutPerBlockCredits, 4)} DASH`,
    `  (62.5% of the masternode share at core height ${core.coreHeight.toLocaleString()}; the other 37.5% funds Platform)`,
  ];
}

/** Multi-line breakdown of a node's estimated monthly earnings, for hover. */
export function monthlyTooltip(row: NodeRow, data: DashboardData): string {
  const perEpoch = data.epochsPerMonth > 0 ? row.estMonthlyPlatformCredits / data.epochsPerMonth : 0;
  const lines = [
    'Estimated monthly earnings (gross)',
    '',
    `Platform proposals: ${dashNum(row.estMonthlyPlatformCredits)} DASH/mo`,
    `· ${dashNum(perEpoch)} DASH avg/epoch over the last ${data.estimateEpochCount} finalized epochs × ${data.epochsPerMonth.toFixed(2)} epochs/mo`,
    '· epoch pool = processing fees + storage distribution + core-reward allocation,',
    '  split by blocks proposed / blocks in epoch',
    '',
    ...coreLines(row, data),
    '',
    `Total: ${dashNum(row.estMonthlyCredits)} DASH/mo — before masternode reward shares`,
  ];
  return lines.join('\n');
}

/** Breakdown for the network-average node, for the summary card. */
export function averageNodeTooltip(data: DashboardData): string {
  const platformAvg =
    data.activeEvonodes > 0 ? (data.avgPoolCredits * data.epochsPerMonth) / data.activeEvonodes : 0;
  const core = data.coreNetwork;
  const lines = [
    'Average enabled evonode, estimated monthly (gross)',
    '',
    `Platform proposals: ${dashNum(platformAvg)} DASH/mo`,
    `· avg epoch pool ${dashNum(data.avgPoolCredits, 0)} DASH × ${data.epochsPerMonth.toFixed(2)} epochs/mo ÷ ${data.activeEvonodes} enabled evonodes`,
    '',
    ...(core
      ? [
          `Core payment queue: ${dashNum(core.evonodeMonthlyCredits)} DASH/mo`,
          `· ≈ ${core.evonodePaymentsPerMonth.toFixed(1)} paid blocks/mo × ${dashNum(core.l1PayoutPerBlockCredits, 4)} DASH (62.5% of MN share)`,
          `· queue = ${core.enabledRegular.toLocaleString()} regular + 4 × ${core.enabledEvonodes.toLocaleString()} evonodes = ${core.paymentQueueWeight.toLocaleString()} blocks`,
        ]
      : ['Core payment queue: unavailable (masternode-count source unreachable).']),
    '',
    `Total: ${dashNum(platformAvg + (core?.evonodeMonthlyCredits ?? 0))} DASH/mo — before masternode reward shares`,
  ];
  return lines.join('\n');
}
