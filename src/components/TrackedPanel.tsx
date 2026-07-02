import { formatDash, formatDuration, shortHash } from '../lib/format';
import type { DashboardData, TrackedLiveData } from '../types';

export function TrackedPanel({
  data,
  tracked,
  live,
  liveLoading,
  now,
  onFetchLive,
  onSelect,
  onUntrack,
}: {
  data: DashboardData;
  tracked: string[];
  live: TrackedLiveData | null;
  liveLoading: boolean;
  now: number;
  onFetchLive: () => void;
  onSelect: (proTxHash: string) => void;
  onUntrack: (proTxHash: string) => void;
}) {
  const rowByHash = new Map(data.nodes.map((n) => [n.proTxHash, n]));

  let totalBalance = 0n;
  let balancesKnown = 0;
  let totalMonthly = 0;
  for (const hash of tracked) {
    const b = live?.balances.get(hash);
    if (b != null) {
      totalBalance += b;
      balancesKnown++;
    }
    totalMonthly += rowByHash.get(hash)?.estMonthlyCredits ?? 0;
  }

  return (
    <section className="tracked">
      <div className="tracked-header">
        <div>
          <h2>
            Tracked evonodes <span className="muted">({tracked.length})</span>
          </h2>
          <div className="card-sub">stored locally in this browser only</div>
        </div>
        <div className="live-row">
          <button className="primary" onClick={onFetchLive} disabled={liveLoading}>
            {liveLoading
              ? 'Querying platform…'
              : live
                ? 'Refresh claimable balances'
                : 'Fetch claimable balances'}
          </button>
          <span className="muted">
            {live
              ? live.error
                ? `failed: ${live.error}`
                : `fetched ${new Date(live.fetchedAt).toLocaleTimeString()} · 2 batched queries`
              : `2 batched queries for all ${tracked.length} nodes`}
          </span>
        </div>
      </div>

      <div className="cards tracked-cards">
        <div className="card good">
          <div className="card-value">
            {live && balancesKnown > 0 ? formatDash(totalBalance) : '—'}
          </div>
          <div className="card-label">Total claimable</div>
          <div className="card-sub">
            {live
              ? `${balancesKnown}/${tracked.length} node identities found`
              : 'fetch to load balances'}
          </div>
        </div>
        <div className="card">
          <div className="card-value">{totalMonthly > 0 ? formatDash(totalMonthly, 2) : '—'}</div>
          <div className="card-label">Combined est. monthly</div>
          <div className="card-sub">gross, before masternode reward shares</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Evonode</th>
              <th>Address</th>
              <th>Claimable</th>
              <th>Blocks this epoch</th>
              <th>Est. monthly</th>
              <th>Next proposal</th>
            </tr>
          </thead>
          <tbody>
            {tracked.map((hash) => {
              const n = rowByHash.get(hash);
              const balance = live?.balances.get(hash);
              const blocks = live?.currentEpochBlocks.get(hash);
              const etaRemaining = n?.eta ? Math.max(0, n.eta.etaMs - (now - data.fetchedAt)) : null;
              return (
                <tr key={hash} onClick={() => onSelect(hash)}>
                  <td>
                    <button
                      className="star active"
                      title="Untrack"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUntrack(hash);
                      }}
                    >
                      ★
                    </button>
                  </td>
                  <td className="mono">
                    {shortHash(hash)}
                    {n && !n.registered && <span className="badge bad">removed</span>}
                    {n?.registered && n.status !== 'ENABLED' && (
                      <span className="badge warn">{(n.status ?? '').toLowerCase()}</span>
                    )}
                  </td>
                  <td className="mono muted">{n?.address ?? '—'}</td>
                  <td>
                    {balance != null ? (
                      formatDash(balance)
                    ) : live && !live.error ? (
                      <span className="muted" title="No identity found for this proTxHash">
                        not found
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{blocks != null ? blocks : <span className="muted">—</span>}</td>
                  <td>
                    {n && n.estMonthlyCredits > 0 ? (
                      formatDash(n.estMonthlyCredits, 2)
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {etaRemaining != null ? formatDuration(etaRemaining) : <span className="muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
