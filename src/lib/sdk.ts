// Proof-verified queries via @dashevo/evo-sdk (WASM), the masternode-list REST
// endpoint, and unproved gRPC-Web fallbacks when the proved path fails.

import { EvoSDK } from '@dashevo/evo-sdk';
import { idToHex, hexToBytes } from './base58';
import {
  fetchFinalizedEpochsUnproved,
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

/** Blocks a node has proposed in the given (current) epoch. One node, one call. */
export async function fetchNodeProposedBlocks(
  network: Network,
  masternodes: MasternodeEntry[],
  epoch: number,
  proTxHashHex: string,
): Promise<number> {
  const idBytes = hexToBytes(proTxHashHex);
  try {
    const sdk = await getSdk(network);
    const counts = await sdk.epoch.evonodesProposedBlocksByIds(epoch, [idBytes]);
    for (const [, count] of counts) return Number(count);
    return 0;
  } catch (e) {
    console.warn('proved evonodesProposedBlocksByIds failed, falling back:', e);
    return fetchProposedBlocksUnproved(network, masternodes, epoch, idBytes);
  }
}

/** Claimable credits: the node identity's balance (identity id == proTxHash). */
export async function fetchNodeBalance(
  network: Network,
  masternodes: MasternodeEntry[],
  proTxHashHex: string,
): Promise<bigint | null> {
  const idBytes = hexToBytes(proTxHashHex);
  try {
    const sdk = await getSdk(network);
    const balance = await sdk.identities.balance(idBytes);
    return balance ?? null;
  } catch (e) {
    console.warn('proved identity balance failed, falling back:', e);
    return fetchIdentityBalanceUnproved(network, masternodes, idBytes);
  }
}
