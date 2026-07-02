// Core-chain (L1) payout math, mirroring Drive's consensus constants
// (packages/rs-dpp/src/core_subsidy in dashpay/platform):
//
//   genesis-scale block subsidy 5 DASH · 60% to masternodes
//   → 3 DASH masternode share, reduced by 1/14 every 210,240 blocks.
//   Since v20, 37.5% of the masternode share of EVERY core block is allocated
//   to Platform (that is FinalizedEpochInfo.coreBlockRewards); the payee in
//   the payment queue receives the remaining 62.5% on L1.
//   Evonodes are paid ONCE per queue cycle, same as regular masternodes:
//   DIP-28's 4-consecutive-payments rule ended with the masternode-reward
//   reallocation fork (verified on-chain: 596 distinct payees over 600 recent
//   blocks, evonode lastpaid blocks 1 apart, consecutivePayments all 0).
//   The 4× collateral is compensated through Platform rewards instead.

import type { MasternodeEntry, Network } from '../types';

const CORE_SUBSIDY_HALVING_INTERVAL = 210_240;
/** 5 DASH × 60% × 37.5%, in credits — Drive's CORE_GENESIS_BLOCK_SUBSIDY. */
const PLATFORM_GENESIS_CREDITS = 112_500_000_000n;

/** Platform's per-core-block credits at a height (integer math, as Drive does). */
export function platformCreditsPerCoreBlock(coreHeight: number): bigint {
  const year = Math.max(0, Math.floor((coreHeight - 1) / CORE_SUBSIDY_HALVING_INTERVAL));
  let distribution = PLATFORM_GENESIS_CREDITS;
  for (let i = 0; i < year; i++) distribution -= distribution / 14n;
  return distribution;
}

/** L1 payment-queue payout per core block: the 62.5% left after Platform's 37.5%. */
export function l1PayoutPerCoreBlockCredits(coreHeight: number): number {
  return Number((platformCreditsPerCoreBlock(coreHeight) * 5n) / 3n);
}

export interface CoreNetworkInfo {
  /** ENABLED masternodes of all types (Core RPC masternodelist). */
  enabledMasternodes: number;
  enabledRegular: number;
  enabledEvonodes: number;
  /** Payment-queue cycle length in blocks: one block per enabled masternode. */
  paymentQueueWeight: number;
  coreBlocksPerMonth: number;
  /** ≈ first core height of the current epoch. */
  coreHeight: number;
  l1PayoutPerBlockCredits: number;
  /** Payment events per month for one enabled evonode (each pays 1 block). */
  evonodePaymentsPerMonth: number;
  /** Estimated monthly L1 income for one enabled evonode, in credits. */
  evonodeMonthlyCredits: number;
}

const RPC_HOSTS: Record<Network, string> = {
  mainnet: 'https://rpc.digitalcash.dev',
  testnet: 'https://trpc.digitalcash.dev',
};

/** ENABLED masternode count (all types) via the public Core RPC gateway. */
export async function fetchEnabledMasternodeCount(network: Network): Promise<number> {
  const res = await fetch(RPC_HOSTS[network], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'masternodelist', params: ['status'] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`core rpc: HTTP ${res.status}`);
  const json = (await res.json()) as { result?: Record<string, string>; error?: { message: string } };
  if (!json.result) throw new Error(`core rpc: ${json.error?.message ?? 'no result'}`);
  return Object.values(json.result).filter((s) => s === 'ENABLED').length;
}

export function buildCoreNetworkInfo(
  enabledMasternodes: number,
  masternodes: MasternodeEntry[],
  coreHeight: number,
  coreBlocksPerMonth: number,
): CoreNetworkInfo {
  const enabledEvonodes = masternodes.filter((m) => m.status === 'ENABLED').length;
  const enabledRegular = Math.max(0, enabledMasternodes - enabledEvonodes);
  const paymentQueueWeight = enabledMasternodes;
  const l1PayoutPerBlockCredits = l1PayoutPerCoreBlockCredits(coreHeight);
  const evonodePaymentsPerMonth =
    paymentQueueWeight > 0 ? coreBlocksPerMonth / paymentQueueWeight : 0;
  return {
    enabledMasternodes,
    enabledRegular,
    enabledEvonodes,
    paymentQueueWeight,
    coreBlocksPerMonth,
    coreHeight,
    l1PayoutPerBlockCredits,
    evonodePaymentsPerMonth,
    evonodeMonthlyCredits: evonodePaymentsPerMonth * l1PayoutPerBlockCredits,
  };
}
