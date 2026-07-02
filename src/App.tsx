import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadDashboardData } from './lib/model';
import {
  fetchMasternodes,
  fetchNodeBalance,
  fetchNodeProposedBlocks,
  fetchNodesBalances,
  fetchNodesProposedBlocks,
} from './lib/sdk';
import { loadTracked, saveTracked } from './lib/tracked';
import { Summary } from './components/Summary';
import { NodeTable } from './components/NodeTable';
import { NodeDetail } from './components/NodeDetail';
import { TrackedPanel } from './components/TrackedPanel';
import type {
  DashboardData,
  LiveNodeData,
  MasternodeEntry,
  Network,
  TrackedLiveData,
} from './types';

export default function App() {
  const [network, setNetwork] = useState<Network>('mainnet');
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState<Map<string, LiveNodeData>>(new Map());
  const [liveLoading, setLiveLoading] = useState(false);
  const [tracked, setTracked] = useState<string[]>(() => loadTracked('mainnet'));
  const [trackedLive, setTrackedLive] = useState<TrackedLiveData | null>(null);
  const [trackedLoading, setTrackedLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const requestId = useRef(0);
  const masternodesRef = useRef<MasternodeEntry[]>([]);

  const refresh = useCallback(async (net: Network) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const next = await loadDashboardData(net);
      masternodesRef.current = await fetchMasternodes(net); // served from browser cache
      if (id === requestId.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      console.error(e);
      if (id === requestId.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    setSelected(null);
    setTracked(loadTracked(network));
    setTrackedLive(null);
    void refresh(network);
  }, [network, refresh]);

  // Local ticker for ETA countdowns — no network traffic.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const liveKey = useCallback(
    (hash: string) => `${network}:${hash}`,
    [network],
  );

  const fetchLive = useCallback(
    async (proTxHash: string) => {
      if (!data) return;
      setLiveLoading(true);
      const epoch = data.currentEpoch.index;
      const mns = masternodesRef.current;
      const entry: LiveNodeData = {
        fetchedAt: Date.now(),
        balance: null,
        currentEpochBlocks: null,
        epochQueried: epoch,
      };
      try {
        const [balance, blocks] = await Promise.all([
          fetchNodeBalance(network, mns, proTxHash),
          fetchNodeProposedBlocks(network, mns, epoch, proTxHash),
        ]);
        entry.balance = balance;
        entry.currentEpochBlocks = blocks;
      } catch (e) {
        console.error(e);
        entry.error = e instanceof Error ? e.message : String(e);
      }
      setLive((prev) => new Map(prev).set(liveKey(proTxHash), entry));
      setLiveLoading(false);
    },
    [data, network, liveKey],
  );

  const fetchTrackedLive = useCallback(async () => {
    if (!data || tracked.length === 0) return;
    setTrackedLoading(true);
    const epoch = data.currentEpoch.index;
    const mns = masternodesRef.current;
    const entry: TrackedLiveData = {
      fetchedAt: Date.now(),
      epochQueried: epoch,
      balances: new Map(),
      currentEpochBlocks: new Map(),
    };
    try {
      const [balances, blocks] = await Promise.all([
        fetchNodesBalances(network, mns, tracked),
        fetchNodesProposedBlocks(network, mns, epoch, tracked),
      ]);
      entry.balances = balances;
      entry.currentEpochBlocks = blocks;
    } catch (e) {
      console.error(e);
      entry.error = e instanceof Error ? e.message : String(e);
    }
    setTrackedLive(entry);
    setTrackedLoading(false);
  }, [data, network, tracked]);

  const toggleTracked = useCallback(
    (proTxHash: string) => {
      const next = tracked.includes(proTxHash)
        ? tracked.filter((h) => h !== proTxHash)
        : [...tracked, proTxHash];
      setTracked(next);
      saveTracked(network, next);
    },
    [tracked, network],
  );

  const trackedSet = useMemo(() => new Set(tracked), [tracked]);

  const selectedLive = useMemo(
    () => (selected ? live.get(liveKey(selected)) : undefined),
    [live, liveKey, selected],
  );

  return (
    <div className="app">
      <header>
        <div>
          <h1>Evonode Payments</h1>
          <p className="subtitle">
            Block proposals and fee-pool earnings per Dash Platform evonode — per-epoch history,
            claimable identity balance, next-proposal estimates, and projected monthly earnings.
          </p>
        </div>
        <div className="header-controls">
          <div className="net-toggle">
            {(['mainnet', 'testnet'] as Network[]).map((net) => (
              <button
                key={net}
                className={network === net ? 'active' : ''}
                onClick={() => setNetwork(net)}
              >
                {net}
              </button>
            ))}
          </div>
          <button className="refresh" onClick={() => void refresh(network)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div className="error">
          Failed to load {network} data: {error}
        </div>
      )}

      {!data && !error && (
        <div className="loading">
          <div className="spinner" />
          Connecting to {network} and loading epoch history…
        </div>
      )}

      {data && (
        <>
          <Summary data={data} now={now} />
          {tracked.length > 0 && (
            <TrackedPanel
              data={data}
              tracked={tracked}
              live={trackedLive}
              liveLoading={trackedLoading}
              now={now}
              onFetchLive={() => void fetchTrackedLive()}
              onSelect={setSelected}
              onUntrack={toggleTracked}
            />
          )}
          {selected && (
            <NodeDetail
              data={data}
              proTxHash={selected}
              live={selectedLive}
              liveLoading={liveLoading}
              now={now}
              tracked={trackedSet.has(selected)}
              onToggleTracked={() => toggleTracked(selected)}
              onFetchLive={() => void fetchLive(selected)}
              onClose={() => setSelected(null)}
            />
          )}
          <NodeTable
            data={data}
            now={now}
            selected={selected}
            tracked={trackedSet}
            onSelect={setSelected}
            onToggleTracked={toggleTracked}
          />
          <footer>
            Fee/proposer data from a single getFinalizedEpochInfos call per load
            {data.proved ? ' (proof-verified via ' : ' (unproved fallback; SDK: '}
            <a href="https://www.npmjs.com/package/@dashevo/evo-sdk">@dashevo/evo-sdk</a>) ·
            per-node balance and current-epoch queries run only on request · tracked nodes are
            stored in this browser only · earnings are gross, before masternode reward shares ·
            updated {new Date(data.fetchedAt).toLocaleTimeString()} ·{' '}
            <a href="https://github.com/dashpay/evonode-payments">source</a>
          </footer>
        </>
      )}
    </div>
  );
}
