import { useMemo, useState } from 'react';
import { formatDash, formatDuration, shortHash } from '../lib/format';
import type { DashboardData, NodeRow } from '../types';

type SortKey =
  | 'proTxHash'
  | 'address'
  | 'lastEpochBlocks'
  | 'lastEpochCredits'
  | 'avgBlocksPerEpoch'
  | 'estMonthlyCredits'
  | 'eta';

type Filter = 'all' | 'quorum' | 'earning' | 'tracked';

const sortValue = (n: NodeRow, key: SortKey): number | string => {
  switch (key) {
    case 'proTxHash':
      return n.proTxHash;
    case 'address':
      return n.address ?? '￿';
    case 'lastEpochBlocks':
      return n.lastEpochBlocks;
    case 'lastEpochCredits':
      return Number(n.lastEpochCredits);
    case 'avgBlocksPerEpoch':
      return n.avgBlocksPerEpoch;
    case 'estMonthlyCredits':
      return n.estMonthlyCredits;
    case 'eta':
      return n.eta ? n.eta.blocks : Number.POSITIVE_INFINITY;
  }
};

export function NodeTable({
  data,
  now,
  selected,
  tracked,
  onSelect,
  onToggleTracked,
}: {
  data: DashboardData;
  now: number;
  selected: string | null;
  tracked: Set<string>;
  onSelect: (proTxHash: string) => void;
  onToggleTracked: (proTxHash: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('estMonthlyCredits');
  const [sortAsc, setSortAsc] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = data.nodes;
    if (filter === 'quorum') out = out.filter((n) => n.inActiveQuorum);
    else if (filter === 'earning') out = out.filter((n) => n.windowCredits > 0n);
    else if (filter === 'tracked') out = out.filter((n) => tracked.has(n.proTxHash));
    if (q) {
      out = out.filter(
        (n) => n.proTxHash.includes(q) || (n.address ?? '').toLowerCase().includes(q),
      );
    }
    return [...out].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortAsc ? cmp : -cmp;
    });
  }, [data.nodes, search, filter, sortKey, sortAsc, tracked]);

  const header = (label: string, key: SortKey) => (
    <th
      onClick={() => {
        if (sortKey === key) setSortAsc(!sortAsc);
        else {
          setSortKey(key);
          setSortAsc(key === 'proTxHash' || key === 'address' || key === 'eta');
        }
      }}
    >
      {label} {sortKey === key ? (sortAsc ? '▲' : '▼') : ''}
    </th>
  );

  const etaCell = (n: NodeRow) => {
    if (!n.eta) return <span className="muted">—</span>;
    const remaining = n.eta.etaMs - (now - data.fetchedAt);
    return (
      <span title={`~${n.eta.blocks} blocks from last refresh`}>
        {formatDuration(Math.max(0, remaining))}
      </span>
    );
  };

  const lastIndex = data.epochs.length ? data.epochs[data.epochs.length - 1].index : '—';

  return (
    <>
      <div className="table-controls">
        <div className="filters">
          {(
            [
              ['all', `All (${data.nodes.length})`],
              ['quorum', 'In active quorums'],
              ['earning', 'Earned in window'],
              ['tracked', `★ Tracked (${tracked.size})`],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {label}
            </button>
          ))}
        </div>
        <input
          placeholder="Search proTxHash or IP…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th title="Track locally"></th>
              {header('Evonode', 'proTxHash')}
              {header('Address', 'address')}
              {header(`Blocks (ep ${lastIndex})`, 'lastEpochBlocks')}
              {header(`Earned (ep ${lastIndex})`, 'lastEpochCredits')}
              {header('Avg blocks/epoch', 'avgBlocksPerEpoch')}
              {header('Est. monthly', 'estMonthlyCredits')}
              {header('Next proposal', 'eta')}
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr
                key={n.proTxHash}
                className={n.proTxHash === selected ? 'selected' : ''}
                onClick={() => onSelect(n.proTxHash)}
              >
                <td>
                  <button
                    className={`star ${tracked.has(n.proTxHash) ? 'active' : ''}`}
                    title={tracked.has(n.proTxHash) ? 'Untrack' : 'Track locally'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTracked(n.proTxHash);
                    }}
                  >
                    {tracked.has(n.proTxHash) ? '★' : '☆'}
                  </button>
                </td>
                <td className="mono">
                  {shortHash(n.proTxHash)}
                  {!n.registered && (
                    <span className="badge bad" title="No longer in the masternode list">
                      removed
                    </span>
                  )}
                  {n.registered && n.status !== 'ENABLED' && (
                    <span className="badge warn">{(n.status ?? '').toLowerCase()}</span>
                  )}
                </td>
                <td className="mono muted">{n.address ?? '—'}</td>
                <td>{n.lastEpochBlocks || <span className="muted">0</span>}</td>
                <td>{n.lastEpochCredits > 0n ? formatDash(n.lastEpochCredits) : <span className="muted">—</span>}</td>
                <td>{n.avgBlocksPerEpoch ? n.avgBlocksPerEpoch.toFixed(1) : <span className="muted">0</span>}</td>
                <td>
                  {n.estMonthlyCredits > 0 ? (
                    formatDash(n.estMonthlyCredits, 2)
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{etaCell(n)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No nodes match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="table-footnote">
        Click a node for its per-epoch history, claimable balance, and live current-epoch count.
        ★ tracks a node locally (this browser only) for the combined claimable-balance view.
        Earnings are gross proposer payouts before masternode reward shares. “Next proposal” is an
        estimate from the current validator-set rotation; nodes outside active quorums enter the
        schedule at the next rotation.
      </p>
    </>
  );
}
