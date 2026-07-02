// Assembles the dashboard model from three platform queries + one REST call.
//
// Payout model (rs-drive-abci add_epoch_pool_to_proposers_payout_operations):
// when an epoch is paid out, each proposer's identity (id == proTxHash) is
// credited  (processing fees + distributed storage fees + core block rewards)
// × proposed_blocks / total_blocks_in_epoch,  minus any masternode reward
// shares. Earnings shown here are therefore gross per-proposer amounts.

import { fetchCurrentQuorumsInfo } from './grpcweb';
import { fetchCurrentEpoch, fetchFinalizedEpochs, fetchMasternodes } from './sdk';
import { buildProposalSchedule } from './schedule';
import type {
  DashboardData,
  EpochSummary,
  Network,
  NodeEpochStat,
  NodeRow,
} from '../types';

const MONTH_MS = 30 * 24 * 3600 * 1000;
/** Finalized epochs fetched per load (still a single platform call). */
const EPOCH_WINDOW = 24;
/** Recent epochs used for the monthly-earnings estimate. */
const ESTIMATE_EPOCHS = 6;

const reverseHex = (h: string): string => {
  let out = '';
  for (let i = h.length - 2; i >= 0; i -= 2) out += h.slice(i, i + 2);
  return out;
};

/**
 * Different layers disagree on hash display order (Core-style reversed vs raw).
 * Given a set of canonical keys, re-key `map` by whichever orientation matches better.
 */
function alignKeys<V>(map: Map<string, V>, canonical: Set<string>): Map<string, V> {
  let straight = 0;
  let reversed = 0;
  for (const key of map.keys()) {
    if (canonical.has(key)) straight++;
    if (canonical.has(reverseHex(key))) reversed++;
  }
  if (reversed <= straight) return map;
  return new Map(Array.from(map.entries(), ([k, v]) => [reverseHex(k), v]));
}

export async function loadDashboardData(network: Network): Promise<DashboardData> {
  const masternodes = await fetchMasternodes(network);

  // Platform call 1: quorums (proposer schedule + chain height/time/epoch).
  const quorums = await fetchCurrentQuorumsInfo(network, masternodes);
  const currentEpochIndex = quorums.metadata.epoch;

  // Platform calls 2 + 3, in parallel: current-epoch info and the finalized
  // window (fee pools + every proposer's block count for each epoch).
  const [currentEpoch, fin] = await Promise.all([
    fetchCurrentEpoch(network),
    fetchFinalizedEpochs(
      network,
      masternodes,
      Math.max(0, currentEpochIndex - EPOCH_WINDOW),
      Math.max(0, currentEpochIndex - 1),
    ),
  ]);

  const canonical = new Set(masternodes.map((m) => m.proTxHash.toLowerCase()));

  // --- epoch summaries -------------------------------------------------------
  const raw = fin.epochs;
  const epochs: EpochSummary[] = raw.map((e, i) => {
    const nextStart =
      i + 1 < raw.length && raw[i + 1].index === e.index + 1
        ? Number(raw[i + 1].firstBlockTime)
        : e.index + 1 === currentEpoch.index
          ? currentEpoch.firstBlockTime
          : NaN;
    const proposers = alignKeys(e.proposers, canonical);
    return {
      index: e.index,
      firstBlockHeight: e.firstBlockHeight,
      firstBlockTime: Number(e.firstBlockTime),
      totalBlocks: Number(e.totalBlocks),
      proposerCount: proposers.size,
      processingFees: e.processingFees,
      distributedStorageFees: e.distributedStorageFees,
      createdStorageFees: e.createdStorageFees,
      coreBlockRewards: e.coreBlockRewards,
      totalPool: e.processingFees + e.distributedStorageFees + e.coreBlockRewards,
      durationMs: nextStart - Number(e.firstBlockTime),
      protocolVersion: e.protocolVersion,
      proposers,
    };
  });

  const knownDurations = epochs.map((e) => e.durationMs).filter((d) => Number.isFinite(d) && d > 0);
  const recentDurations = knownDurations.slice(-ESTIMATE_EPOCHS);
  const avgEpochDurationMs = recentDurations.length
    ? recentDurations.reduce((s, d) => s + d, 0) / recentDurations.length
    : network === 'mainnet'
      ? 9.125 * 24 * 3600 * 1000
      : 9.125 * 3600 * 1000;
  const epochsPerMonth = MONTH_MS / avgEpochDurationMs;

  // --- per-node stats --------------------------------------------------------
  const perNode = new Map<string, NodeEpochStat[]>();
  for (const e of epochs) {
    if (e.totalBlocks === 0) continue;
    for (const [id, blocks] of e.proposers) {
      const credits = (e.totalPool * BigInt(blocks)) / BigInt(e.totalBlocks);
      let stats = perNode.get(id);
      if (!stats) {
        stats = [];
        perNode.set(id, stats);
      }
      stats.push({ epoch: e.index, blocks, credits, share: blocks / e.totalBlocks });
    }
  }

  // --- schedule + quorum membership -----------------------------------------
  const blocksInEpoch = Number(quorums.metadata.height - currentEpoch.firstBlockHeight);
  const msInEpoch = Number(quorums.metadata.timeMs) - currentEpoch.firstBlockTime;
  const avgBlockTimeMs =
    blocksInEpoch > 10 ? msInEpoch / blocksInEpoch : network === 'mainnet' ? 161_000 : 6_500;

  const schedule = alignKeys(buildProposalSchedule(quorums, avgBlockTimeMs), canonical);

  const activeMembers = new Set<string>();
  for (const vs of quorums.validatorSets) {
    for (const m of vs.members) {
      const display = m.proTxHash.toLowerCase();
      activeMembers.add(canonical.has(display) ? display : reverseHex(display));
    }
  }

  // --- rows ------------------------------------------------------------------
  const estimateWindow = epochs.slice(-ESTIMATE_EPOCHS);
  const estimateSpanMs = estimateWindow.reduce(
    (s, e) => s + (Number.isFinite(e.durationMs) ? e.durationMs : avgEpochDurationMs),
    0,
  );
  const estimateEpochSet = new Set(estimateWindow.map((e) => e.index));
  const lastEpochIndex = epochs.length ? epochs[epochs.length - 1].index : -1;

  const buildRow = (proTxHash: string): NodeRow => {
    const stats = perNode.get(proTxHash) ?? [];
    const last = stats.find((s) => s.epoch === lastEpochIndex);
    let windowCredits = 0n;
    let windowBlocks = 0;
    let estimateCredits = 0n;
    for (const s of stats) {
      windowCredits += s.credits;
      windowBlocks += s.blocks;
      if (estimateEpochSet.has(s.epoch)) estimateCredits += s.credits;
    }
    return {
      proTxHash,
      registered: false,
      lastEpochBlocks: last?.blocks ?? 0,
      lastEpochCredits: last?.credits ?? 0n,
      avgBlocksPerEpoch: epochs.length ? windowBlocks / epochs.length : 0,
      windowCredits,
      estMonthlyCredits:
        estimateSpanMs > 0 ? Number(estimateCredits) * (MONTH_MS / estimateSpanMs) : 0,
      inActiveQuorum: activeMembers.has(proTxHash),
      eta: schedule.get(proTxHash),
    };
  };

  const rows = new Map<string, NodeRow>();
  for (const m of masternodes) {
    const key = m.proTxHash.toLowerCase();
    const row = buildRow(key);
    row.registered = true;
    row.address = m.address;
    row.status = m.status;
    rows.set(key, row);
  }
  // Proposers with history that are no longer in the endpoint list.
  for (const key of perNode.keys()) {
    if (!rows.has(key)) rows.set(key, buildRow(key));
  }

  const avgPoolCredits = epochs.length
    ? epochs.reduce((s, e) => s + Number(e.totalPool), 0) / epochs.length
    : 0;

  return {
    network,
    fetchedAt: Date.now(),
    currentEpoch,
    height: quorums.metadata.height,
    timeMs: Number(quorums.metadata.timeMs),
    epochs,
    perNode,
    nodes: Array.from(rows.values()),
    avgBlockTimeMs,
    avgEpochDurationMs,
    epochsPerMonth,
    activeEvonodes: masternodes.filter((m) => m.status === 'ENABLED').length,
    avgPoolCredits,
    proved: fin.proved,
  };
}
