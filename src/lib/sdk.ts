// Proof-verified queries via @dashevo/evo-sdk (WASM), the masternode-list REST
// endpoint, and unproved gRPC-Web fallbacks when the proved path fails.

import { EvoSDK } from '@dashevo/evo-sdk';
import { idToHex, hexToBytes } from './base58';
import {
  fetchFinalizedEpochsUnproved,
  fetchIdentitiesBalancesUnproved,
  fetchIdentityBalanceUnproved,
  fetchProposedBlocksUnproved,
  type RawFinalizedEpoch,
} from './grpcweb';
import type { CurrentEpochInfo, MasternodeEntry, Network } from '../types';

const instances: Partial<Record<Network, Promise<EvoSDK>>> = {};

export function getSdk(network: Network): Promise<EvoSDK> {
  if (!instances[network]) {
    instances[network] = (async () => {
      const sdk = network === 'mainnet' ? EvoSDK.mainnetTrusted() : EvoSDK.testnetTrusted();
      await sdk.connect();
      return sdk;
    })();
  }
  return instances[network]!;
}

/** Evonode list with software versions from the trusted-context endpoint. */
export async function fetchMasternodes(network: Network): Promise<MasternodeEntry[]> {
  const res = await fetch(`https://quorums.${network}.networks.dash.org/masternodes`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`masternodes endpoint: HTTP ${res.status}`);
  const json = (await res.json()) as { success: boolean; data: MasternodeEntry[] };
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error('masternodes endpoint: unexpected payload');
  }
  return json.data;
}

export async function fetchCurrentEpoch(network: Network): Promise<CurrentEpochInfo> {
  const sdk = await getSdk(network);
  const e = await sdk.epoch.current();
  return {
    index: e.index,
    firstBlockHeight: BigInt(e.firstBlockHeight),
    firstBlockTime: Number(e.firstBlockTime),
    protocolVersion: e.protocolVersion,
  };
}

export interface FinalizedEpochsResult {
  epochs: RawFinalizedEpoch[];
  proved: boolean;
}

/**
 * Finalized epochs [startEpoch..endEpoch] — fee pools plus every proposer's
 * block count, in ONE platform call. Proved via SDK, falling back to a direct
 * unproved gRPC-Web call.
 */
export async function fetchFinalizedEpochs(
  network: Network,
  masternodes: MasternodeEntry[],
  startEpoch: number,
  endEpoch: number,
): Promise<FinalizedEpochsResult> {
  try {
    const sdk = await getSdk(network);
    const infos = await sdk.epoch.finalizedInfos({
      startEpoch,
      count: endEpoch - startEpoch + 1,
      ascending: true,
    });
    const epochs: RawFinalizedEpoch[] = [];
    for (const [index, info] of infos) {
      if (!info) continue;
      const proposers = new Map<string, number>();
      for (const [key, count] of info.blockProposers) {
        proposers.set(idToHex(key), Number(count));
      }
      epochs.push({
        index,
        firstBlockHeight: info.firstBlockHeight,
        firstBlockTime: info.firstBlockTime,
        firstCoreBlockHeight: info.firstCoreBlockHeight,
        nextEpochStartCoreBlockHeight: info.nextEpochStartCoreBlockHeight,
        totalBlocks: info.totalBlocksInEpoch,
        processingFees: info.totalProcessingFees,
        distributedStorageFees: info.totalDistributedStorageFees,
        createdStorageFees: info.totalCreatedStorageFees,
        coreBlockRewards: info.coreBlockRewards,
        protocolVersion: info.protocolVersion,
        proposers,
      });
    }
    epochs.sort((a, b) => a.index - b.index);
    return { epochs, proved: true };
  } catch (e) {
    console.warn('proved finalizedInfos failed, falling back to unproved gRPC-Web:', e);
    const epochs = await fetchFinalizedEpochsUnproved(network, masternodes, startEpoch, endEpoch);
    return { epochs, proved: false };
  }
}

const reverseHex = (h: string): string => {
  let out = '';
  for (let i = h.length - 2; i >= 0; i -= 2) out += h.slice(i, i + 2);
  return out;
};

/**
 * Responses key identifiers as base58 or hex, sometimes in Core-reversed byte
 * order. Re-key onto the exact display-hex hashes that were requested.
 */
function rekeyOntoRequested<V>(map: Map<string, V>, requested: string[]): Map<string, V> {
  const want = new Set(requested);
  const out = new Map<string, V>();
  for (const [rawKey, value] of map) {
    const key = idToHex(rawKey);
    out.set(want.has(key) ? key : reverseHex(key), value);
  }
  return out;
}

/**
 * Blocks each node has proposed in the given (current) epoch — display-hex
 * proTxHash -> count. Any number of nodes, one platform call.
 */
export async function fetchNodesProposedBlocks(
  network: Network,
  masternodes: MasternodeEntry[],
  epoch: number,
  proTxHashes: string[],
): Promise<Map<string, number>> {
  const ids = proTxHashes.map(hexToBytes);
  let raw: Map<string, number>;
  try {
    const sdk = await getSdk(network);
    const counts = await sdk.epoch.evonodesProposedBlocksByIds(epoch, ids);
    raw = new Map(Array.from(counts, ([k, v]) => [k, Number(v)]));
  } catch (e) {
    console.warn('proved evonodesProposedBlocksByIds failed, falling back:', e);
    raw = await fetchProposedBlocksUnproved(network, masternodes, epoch, ids);
  }
  const rekeyed = rekeyOntoRequested(raw, proTxHashes);
  // Nodes with no entry have proposed nothing this epoch.
  return new Map(proTxHashes.map((h) => [h, rekeyed.get(h) ?? 0]));
}

/**
 * Claimable credits — display-hex proTxHash -> node-identity balance
 * (identity id == proTxHash). Any number of nodes, one platform call.
 */
export async function fetchNodesBalances(
  network: Network,
  masternodes: MasternodeEntry[],
  proTxHashes: string[],
): Promise<Map<string, bigint | null>> {
  const ids = proTxHashes.map(hexToBytes);
  let raw: Map<string, bigint | null>;
  try {
    const sdk = await getSdk(network);
    const balances = await sdk.identities.balances(ids);
    raw = new Map(Array.from(balances, ([k, v]) => [k, v ?? null]));
  } catch (e) {
    console.warn('proved identities balances failed, falling back:', e);
    if (ids.length === 1) {
      raw = new Map([[proTxHashes[0], await fetchIdentityBalanceUnproved(network, masternodes, ids[0])]]);
    } else {
      raw = await fetchIdentitiesBalancesUnproved(network, masternodes, ids);
    }
  }
  const rekeyed = rekeyOntoRequested(raw, proTxHashes);
  return new Map(proTxHashes.map((h) => [h, rekeyed.get(h) ?? null]));
}

/** Single-node conveniences for the detail panel. */
export async function fetchNodeProposedBlocks(
  network: Network,
  masternodes: MasternodeEntry[],
  epoch: number,
  proTxHashHex: string,
): Promise<number> {
  const map = await fetchNodesProposedBlocks(network, masternodes, epoch, [proTxHashHex]);
  return map.get(proTxHashHex) ?? 0;
}

export async function fetchNodeBalance(
  network: Network,
  masternodes: MasternodeEntry[],
  proTxHashHex: string,
): Promise<bigint | null> {
  const map = await fetchNodesBalances(network, masternodes, [proTxHashHex]);
  return map.get(proTxHashHex) ?? null;
}
