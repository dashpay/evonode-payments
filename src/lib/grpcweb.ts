// Minimal gRPC-Web (application/grpc-web+proto) client for the DAPI calls this
// dashboard makes without the SDK: Platform.getCurrentQuorumsInfo (which the
// wasm-sdk binding truncates) and unproved fallbacks for the payment queries in
// case the proved SDK path is unavailable on a network.
//
// Hand-rolled to avoid pulling the full @dashevo/dapi-grpc dependency tree into
// a static site. Field numbers mirror packages/dapi-grpc/protos/platform/v0/platform.proto.

import type {
  CurrentQuorumsInfo,
  MasternodeEntry,
  Network,
  ValidatorMember,
  ValidatorSet,
} from '../types';

// Evonodes serve gRPC-Web over HTTPS with IP-SAN certificates on the platform
// port (443 on mainnet, 1443 on testnet) — the same endpoints the WASM SDK uses.
function dapiEndpoints(network: Network, masternodes: MasternodeEntry[]): string[] {
  const port = network === 'mainnet' ? '' : ':1443';
  return masternodes
    .filter((m) => m.status === 'ENABLED' && m.versionCheck === 'success')
    .map((m) => `https://${m.address.replace(/:\d+$/, '')}${port}`);
}

// --- protobuf reader/writer --------------------------------------------------

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  get eof(): boolean {
    return this.pos >= this.buf.length;
  }

  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const b = this.buf[this.pos++];
      if (b === undefined) throw new Error('varint past end of buffer');
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
  }

  tag(): { field: number; wire: number } {
    const t = Number(this.varint());
    return { field: t >>> 3, wire: t & 7 };
  }

  bytes(): Uint8Array {
    const len = Number(this.varint());
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  string(): string {
    return new TextDecoder().decode(this.bytes());
  }

  double(): number {
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return v;
  }

  skip(wire: number): void {
    switch (wire) {
      case 0:
        this.varint();
        break;
      case 1:
        this.pos += 8;
        break;
      case 2:
        this.bytes();
        break;
      case 5:
        this.pos += 4;
        break;
      default:
        throw new Error(`unsupported wire type ${wire}`);
    }
  }
}

function varintBytes(n: number | bigint): number[] {
  const out: number[] = [];
  let v = BigInt(n);
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if (v === 0n) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
}

// --- hash display helpers ----------------------------------------------------

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Core-style display of a hash (byte order reversed, like txids/proTxHashes). */
export const displayHash = (b: Uint8Array): string => hex(Uint8Array.from(b).reverse());

export const compareBytes = (a: Uint8Array, b: Uint8Array): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
};

// --- gRPC-Web transport ------------------------------------------------------

function grpcWebFrames(body: Uint8Array): Uint8Array {
  // Data frames only (flag 0x00); trailer frames (flag 0x80) are ignored.
  const chunks: Uint8Array[] = [];
  let pos = 0;
  while (pos + 5 <= body.length) {
    const flag = body[pos];
    const len =
      (body[pos + 1] << 24) | (body[pos + 2] << 16) | (body[pos + 3] << 8) | body[pos + 4];
    const payload = body.subarray(pos + 5, pos + 5 + len);
    pos += 5 + len;
    if (flag === 0) chunks.push(payload);
  }
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function grpcCall(endpoint: string, method: string, request: Uint8Array): Promise<Uint8Array> {
  const framed = new Uint8Array(5 + request.length);
  new DataView(framed.buffer).setUint32(1, request.length, false);
  framed.set(request, 5);

  const res = await fetch(`${endpoint}/org.dash.platform.dapi.v0.Platform/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/grpc-web+proto',
      'x-grpc-web': '1',
    },
    body: framed,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
  const grpcStatus = res.headers.get('grpc-status');
  if (grpcStatus && grpcStatus !== '0') {
    throw new Error(`${endpoint}: grpc-status ${grpcStatus} ${res.headers.get('grpc-message') ?? ''}`);
  }
  return grpcWebFrames(new Uint8Array(await res.arrayBuffer()));
}

async function withEndpoints<T>(
  network: Network,
  masternodes: MasternodeEntry[],
  fn: (endpoint: string) => Promise<T>,
): Promise<T> {
  const endpoints = dapiEndpoints(network, masternodes).sort(() => Math.random() - 0.5);
  let lastError: unknown;
  for (const endpoint of endpoints.slice(0, 8)) {
    try {
      return await fn(endpoint);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('no DAPI endpoint reachable');
}

// --- getCurrentQuorumsInfo ---------------------------------------------------

function parseValidator(buf: Uint8Array): ValidatorMember {
  const r = new Reader(buf);
  let proTxHashBytes = new Uint8Array();
  let nodeIp = '';
  let isBanned = false;
  while (!r.eof) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) proTxHashBytes = Uint8Array.from(r.bytes());
    else if (field === 2 && wire === 2) nodeIp = r.string();
    else if (field === 3 && wire === 0) isBanned = r.varint() !== 0n;
    else r.skip(wire);
  }
  return { proTxHashBytes, proTxHash: displayHash(proTxHashBytes), nodeIp, isBanned };
}

function parseValidatorSet(buf: Uint8Array): ValidatorSet {
  const r = new Reader(buf);
  let quorumHashHex = '';
  let coreHeight = 0;
  const members: ValidatorMember[] = [];
  while (!r.eof) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) quorumHashHex = hex(r.bytes());
    else if (field === 2 && wire === 0) coreHeight = Number(r.varint());
    else if (field === 3 && wire === 2) members.push(parseValidator(r.bytes()));
    else r.skip(wire);
  }
  members.sort((a, b) => compareBytes(a.proTxHashBytes, b.proTxHashBytes));
  return { quorumHashHex, coreHeight, members };
}

interface Metadata {
  height: bigint;
  timeMs: bigint;
  epoch: number;
  protocolVersion: number;
  chainId: string;
}

function parseMetadata(buf: Uint8Array): Metadata {
  const m = new Reader(buf);
  const metadata: Metadata = { height: 0n, timeMs: 0n, epoch: 0, protocolVersion: 0, chainId: '' };
  while (!m.eof) {
    const t = m.tag();
    if (t.field === 1 && t.wire === 0) metadata.height = m.varint();
    else if (t.field === 3 && t.wire === 0) metadata.epoch = Number(m.varint());
    else if (t.field === 4 && t.wire === 0) metadata.timeMs = m.varint();
    else if (t.field === 5 && t.wire === 0) metadata.protocolVersion = Number(m.varint());
    else if (t.field === 6 && t.wire === 2) metadata.chainId = m.string();
    else m.skip(t.wire);
  }
  return metadata;
}

function parseQuorumsResponseV0(buf: Uint8Array): CurrentQuorumsInfo {
  const r = new Reader(buf);
  const quorumHashes: string[] = [];
  let currentQuorumHash = '';
  const validatorSets: ValidatorSet[] = [];
  let lastBlockProposerBytes = new Uint8Array();
  let metadata: Metadata = { height: 0n, timeMs: 0n, epoch: 0, protocolVersion: 0, chainId: '' };
  while (!r.eof) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) quorumHashes.push(hex(r.bytes()));
    else if (field === 2 && wire === 2) currentQuorumHash = hex(r.bytes());
    else if (field === 3 && wire === 2) validatorSets.push(parseValidatorSet(r.bytes()));
    else if (field === 4 && wire === 2) lastBlockProposerBytes = Uint8Array.from(r.bytes());
    else if (field === 5 && wire === 2) metadata = parseMetadata(r.bytes());
    else r.skip(wire);
  }
  return {
    quorumHashes,
    currentQuorumHash,
    validatorSets,
    lastBlockProposer: displayHash(lastBlockProposerBytes),
    lastBlockProposerBytes,
    metadata,
  };
}

/** Fetch current quorums info, trying random evonode endpoints until one answers. */
export async function fetchCurrentQuorumsInfo(
  network: Network,
  masternodes: MasternodeEntry[],
): Promise<CurrentQuorumsInfo> {
  // GetCurrentQuorumsInfoRequest { v0: {} } → field 1, empty embedded message.
  const request = new Uint8Array([0x0a, 0x00]);
  return withEndpoints(network, masternodes, async (endpoint) => {
    const message = await grpcCall(endpoint, 'getCurrentQuorumsInfo', request);
    const r = new Reader(message);
    while (!r.eof) {
      const { field, wire } = r.tag();
      if (field === 1 && wire === 2) return parseQuorumsResponseV0(r.bytes());
      r.skip(wire);
    }
    throw new Error(`${endpoint}: empty getCurrentQuorumsInfo response`);
  });
}

// --- unproved fallbacks for the payment queries ------------------------------

export interface RawFinalizedEpoch {
  index: number;
  firstBlockHeight: bigint;
  firstBlockTime: bigint;
  firstCoreBlockHeight: number;
  nextEpochStartCoreBlockHeight: number;
  totalBlocks: bigint;
  processingFees: bigint;
  distributedStorageFees: bigint;
  createdStorageFees: bigint;
  coreBlockRewards: bigint;
  protocolVersion: number;
  /** display-hex proposer id -> block count */
  proposers: Map<string, number>;
  metadata?: Metadata;
}

function parseFinalizedEpochInfo(buf: Uint8Array): RawFinalizedEpoch {
  const r = new Reader(buf);
  const e: RawFinalizedEpoch = {
    index: 0,
    firstBlockHeight: 0n,
    firstBlockTime: 0n,
    firstCoreBlockHeight: 0,
    nextEpochStartCoreBlockHeight: 0,
    totalBlocks: 0n,
    processingFees: 0n,
    distributedStorageFees: 0n,
    createdStorageFees: 0n,
    coreBlockRewards: 0n,
    protocolVersion: 0,
    proposers: new Map(),
  };
  while (!r.eof) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 0) e.index = Number(r.varint());
    else if (field === 2 && wire === 0) e.firstBlockHeight = r.varint();
    else if (field === 3 && wire === 0) e.firstCoreBlockHeight = Number(r.varint());
    else if (field === 4 && wire === 0) e.firstBlockTime = r.varint();
    else if (field === 8 && wire === 0) e.nextEpochStartCoreBlockHeight = Number(r.varint());
    else if (field === 7 && wire === 0) e.totalBlocks = r.varint();
    else if (field === 9 && wire === 0) e.processingFees = r.varint();
    else if (field === 10 && wire === 0) e.distributedStorageFees = r.varint();
    else if (field === 11 && wire === 0) e.createdStorageFees = r.varint();
    else if (field === 12 && wire === 0) e.coreBlockRewards = r.varint();
    else if (field === 6 && wire === 0) e.protocolVersion = Number(r.varint());
    else if (field === 13 && wire === 2) {
      const p = new Reader(r.bytes());
      let id = new Uint8Array();
      let count = 0;
      while (!p.eof) {
        const t = p.tag();
        if (t.field === 1 && t.wire === 2) id = Uint8Array.from(p.bytes());
        else if (t.field === 2 && t.wire === 0) count = Number(p.varint());
        else p.skip(t.wire);
      }
      // Proposer ids arrive in the same byte order the /masternodes endpoint
      // displays (verified empirically on mainnet) — no reversal.
      e.proposers.set(hex(id), count);
    } else r.skip(wire);
  }
  return e;
}

/** Unproved getFinalizedEpochInfos: one call returns fee pools + all proposer counts. */
export async function fetchFinalizedEpochsUnproved(
  network: Network,
  masternodes: MasternodeEntry[],
  startEpoch: number,
  endEpoch: number,
): Promise<RawFinalizedEpoch[]> {
  const inner = [
    0x08,
    ...varintBytes(startEpoch),
    0x10,
    0x01, // start included
    0x18,
    ...varintBytes(endEpoch),
    0x20,
    0x01, // end included
  ];
  const request = new Uint8Array([0x0a, ...varintBytes(inner.length), ...inner]);

  return withEndpoints(network, masternodes, async (endpoint) => {
    const message = await grpcCall(endpoint, 'getFinalizedEpochInfos', request);
    const epochs: RawFinalizedEpoch[] = [];
    let metadata: Metadata | undefined;
    const r = new Reader(message);
    while (!r.eof) {
      const { field, wire } = r.tag();
      if (field === 1 && wire === 2) {
        const v0 = new Reader(r.bytes());
        while (!v0.eof) {
          const t = v0.tag();
          if (t.field === 1 && t.wire === 2) {
            const list = new Reader(v0.bytes());
            while (!list.eof) {
              const lt = list.tag();
              if (lt.field === 1 && lt.wire === 2) epochs.push(parseFinalizedEpochInfo(list.bytes()));
              else list.skip(lt.wire);
            }
          } else if (t.field === 3 && t.wire === 2) metadata = parseMetadata(v0.bytes());
          else v0.skip(t.wire);
        }
      } else r.skip(wire);
    }
    for (const e of epochs) e.metadata = metadata;
    return epochs;
  });
}

/** Unproved getEvonodesProposedEpochBlocksByIds — display-hex id -> block count. */
export async function fetchProposedBlocksUnproved(
  network: Network,
  masternodes: MasternodeEntry[],
  epoch: number,
  ids: Uint8Array[],
): Promise<Map<string, number>> {
  const inner = [0x08, ...varintBytes(epoch)];
  for (const id of ids) inner.push(0x12, ...varintBytes(id.length), ...id);
  const request = new Uint8Array([0x0a, ...varintBytes(inner.length), ...inner]);

  return withEndpoints(network, masternodes, async (endpoint) => {
    const message = await grpcCall(endpoint, 'getEvonodesProposedEpochBlocksByIds', request);
    const counts = new Map<string, number>();
    const r = new Reader(message);
    while (!r.eof) {
      const { field, wire } = r.tag();
      if (field === 1 && wire === 2) {
        const v0 = new Reader(r.bytes());
        while (!v0.eof) {
          const t = v0.tag();
          if (t.field === 1 && t.wire === 2) {
            const info = new Reader(v0.bytes());
            while (!info.eof) {
              const it = info.tag();
              if (it.field === 1 && it.wire === 2) {
                const e = new Reader(info.bytes());
                let id = new Uint8Array();
                let count = 0;
                while (!e.eof) {
                  const et = e.tag();
                  if (et.field === 1 && et.wire === 2) id = Uint8Array.from(e.bytes());
                  else if (et.field === 2 && et.wire === 0) count = Number(e.varint());
                  else e.skip(et.wire);
                }
                counts.set(hex(id), count);
              } else info.skip(it.wire);
            }
          } else v0.skip(t.wire);
        }
      } else r.skip(wire);
    }
    return counts; // absent ids proposed nothing this epoch
  });
}

/** Unproved getIdentitiesBalances — display-hex id -> credits (null if no identity). */
export async function fetchIdentitiesBalancesUnproved(
  network: Network,
  masternodes: MasternodeEntry[],
  ids: Uint8Array[],
): Promise<Map<string, bigint | null>> {
  const inner: number[] = [];
  for (const id of ids) inner.push(0x0a, ...varintBytes(id.length), ...id);
  const request = new Uint8Array([0x0a, ...varintBytes(inner.length), ...inner]);

  return withEndpoints(network, masternodes, async (endpoint) => {
    const message = await grpcCall(endpoint, 'getIdentitiesBalances', request);
    const balances = new Map<string, bigint | null>();
    const r = new Reader(message);
    while (!r.eof) {
      const { field, wire } = r.tag();
      if (field === 1 && wire === 2) {
        const v0 = new Reader(r.bytes());
        while (!v0.eof) {
          const t = v0.tag();
          if (t.field === 1 && t.wire === 2) {
            const list = new Reader(v0.bytes());
            while (!list.eof) {
              const lt = list.tag();
              if (lt.field === 1 && lt.wire === 2) {
                const e = new Reader(list.bytes());
                let id = new Uint8Array();
                let balance: bigint | null = null;
                while (!e.eof) {
                  const et = e.tag();
                  if (et.field === 1 && et.wire === 2) id = Uint8Array.from(e.bytes());
                  else if (et.field === 2 && et.wire === 0) balance = e.varint();
                  else e.skip(et.wire);
                }
                balances.set(hex(id), balance);
              } else list.skip(lt.wire);
            }
          } else v0.skip(t.wire);
        }
      } else r.skip(wire);
    }
    return balances;
  });
}

/** Unproved getIdentityBalance for a node identity (identity id == proTxHash bytes). */
export async function fetchIdentityBalanceUnproved(
  network: Network,
  masternodes: MasternodeEntry[],
  idBytes: Uint8Array,
): Promise<bigint | null> {
  const inner = [0x0a, ...varintBytes(idBytes.length), ...idBytes];
  const request = new Uint8Array([0x0a, ...varintBytes(inner.length), ...inner]);

  return withEndpoints(network, masternodes, async (endpoint) => {
    const message = await grpcCall(endpoint, 'getIdentityBalance', request);
    const r = new Reader(message);
    while (!r.eof) {
      const { field, wire } = r.tag();
      if (field === 1 && wire === 2) {
        const v0 = new Reader(r.bytes());
        while (!v0.eof) {
          const t = v0.tag();
          if (t.field === 1 && t.wire === 0) return v0.varint();
          v0.skip(t.wire);
        }
      } else r.skip(wire);
    }
    return null;
  });
}
