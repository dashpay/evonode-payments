export type Network = 'mainnet' | 'testnet';

/** Entry from quorums.{net}.networks.dash.org/masternodes (evonodes only). */
export interface MasternodeEntry {
  proTxHash: string;
  address: string;
  status: string;
  versionCheck?: string;
  dapiVersion?: string;
  driveVersion?: string;
}

// --- getCurrentQuorumsInfo (proposer schedule) -------------------------------

export interface ValidatorMember {
  proTxHashBytes: Uint8Array;
  proTxHash: string;
  nodeIp: string;
  isBanned: boolean;
}

export interface ValidatorSet {
  quorumHashHex: string;
  coreHeight: number;
  members: ValidatorMember[];
}

export interface CurrentQuorumsInfo {
  quorumHashes: string[];
  currentQuorumHash: string;
  validatorSets: ValidatorSet[];
  lastBlockProposer: string;
  lastBlockProposerBytes: Uint8Array;
  metadata: {
    height: bigint;
    timeMs: bigint;
    epoch: number;
    protocolVersion: number;
    chainId: string;
  };
}

/** Estimated next block-proposal slot for a node. */
export interface ProposalEta {
  blocks: number;
  etaMs: number;
  quorumHash: string;
}

// --- epochs and earnings ------------------------------------------------------

/** One finalized epoch: fee pools plus every proposer's block count. */
export interface EpochSummary {
  index: number;
  firstBlockHeight: bigint;
  firstBlockTime: number; // ms
  totalBlocks: number;
  proposerCount: number;
  processingFees: bigint;
  distributedStorageFees: bigint;
  createdStorageFees: bigint;
  coreBlockRewards: bigint;
  /** processingFees + distributedStorageFees + coreBlockRewards — what proposers split. */
  totalPool: bigint;
  /** Time to the next epoch's first block; known for every fetched epoch. */
  durationMs: number;
  protocolVersion: number;
  /** proposer proTxHash (display hex, lowercase) -> blocks proposed */
  proposers: Map<string, number>;
}

export interface NodeEpochStat {
  epoch: number;
  blocks: number;
  /** Gross payout share of the epoch pool, before masternode reward shares. */
  credits: bigint;
  share: number;
}

export interface NodeRow {
  proTxHash: string; // canonical display hex, lowercase
  address?: string;
  status?: string;
  /** In the /masternodes endpoint list (false for since-removed nodes with history). */
  registered: boolean;
  lastEpochBlocks: number;
  lastEpochCredits: bigint;
  avgBlocksPerEpoch: number;
  windowCredits: bigint;
  /** Estimated gross credits per 30 days, from recent epochs. */
  estMonthlyCredits: number;
  inActiveQuorum: boolean;
  eta?: ProposalEta;
}

export interface CurrentEpochInfo {
  index: number;
  firstBlockHeight: bigint;
  firstBlockTime: number; // ms
  protocolVersion: number;
}

export interface DashboardData {
  network: Network;
  fetchedAt: number;
  currentEpoch: CurrentEpochInfo;
  /** Chain height / time at fetch (from quorums metadata). */
  height: bigint;
  timeMs: number;
  /** Finalized epochs, ascending. */
  epochs: EpochSummary[];
  perNode: Map<string, NodeEpochStat[]>;
  nodes: NodeRow[];
  avgBlockTimeMs: number;
  avgEpochDurationMs: number;
  epochsPerMonth: number;
  activeEvonodes: number;
  avgPoolCredits: number;
  /** Whether epoch/proposer data came proof-verified through the SDK. */
  proved: boolean;
}

/** Per-node data fetched on demand (button press). */
export interface LiveNodeData {
  fetchedAt: number;
  balance: bigint | null;
  currentEpochBlocks: number | null;
  epochQueried: number;
  error?: string;
}

/** Batched on-demand data for all tracked nodes (2 platform calls total). */
export interface TrackedLiveData {
  fetchedAt: number;
  epochQueried: number;
  balances: Map<string, bigint | null>;
  currentEpochBlocks: Map<string, number>;
  error?: string;
}
