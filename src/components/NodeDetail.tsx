import { useMemo } from 'react';
import {
  etaRemainingBlocks,
  etaTooltip,
  formatCredits,
  formatDash,
  formatDate,
  monthlyTooltip,
  shortHash,
} from '../lib/format';
import type { DashboardData, LiveNodeData, NodeEpochStat } from '../types';

export function NodeDetail({
  data,
  proTxHash,
  live,
  liveLoading,
  now,
  tracked,
  onToggleTracked,
  onFetchLive,
  onClose,
}: {
  data: DashboardData;
  proTxHash: string;
  live: LiveNodeData | undefined;
  liveLoading: boolean;
  now: number;
  tracked: boolean;
  onToggleTracked: () => void;
  onFetchLive: () => void;
  onClose: () => void;
}) {
  const row = data.nodes.find((n) => n.proTxHash === proTxHash);
  const stats = useMemo(() => {
    const byEpoch = new Map<number, NodeEpochStat>(
      (data.perNode.get(proTxHash) ?? []).map((s) => [s.epoch, s]),
    );
    return data.epochs.map((e) => ({
      epoch: e,
      stat: byEpoch.get(e.index),
    }));
  }, [data, proTxHash]);

  const maxBlocks = Math.max(1, ...stats.map((s) => s.stat?.blocks ?? 0));

  const eta = row?.eta;

  // Value accrued so far this epoch, priced at the last finalized epoch's per-block rate.
  const lastEpoch = data.epochs.length ? data.epochs[data.epochs.length - 1] : null;
  const perBlockCredits =
    lastEpoch && lastEpoch.totalBlocks > 0 ? lastEpoch.totalPool / BigInt(lastEpoch.totalBlocks) : 0n;
  const accrued =
    live?.currentEpochBlocks != null ? perBlockCredits * BigInt(live.currentEpochBlocks) : null;

  return (
    <section className="detail">
      <div className="detail-header">
        <div>
          <h2 className="mono">{shortHash(proTxHash)}</h2>
          <div className="detail-meta">
            <span className="mono muted" title={proTxHash}>
              {proTxHash}
            </span>
            {row?.address && <span className="mono">{row.address}</span>}
            {row?.status && (
              <span className={`badge ${row.status === 'ENABLED' ? 'good' : 'warn'}`}>
                {row.status.toLowerCase()}
              </span>
            )}
            {!row?.registered && <span className="badge bad">removed from list</span>}
            {row?.inActiveQuorum && <span className="badge neutral">active quorum</span>}
          </div>
        </div>
        <div className="detail-actions">
          <button className={`refresh ${tracked ? 'tracked-btn' : ''}`} onClick={onToggleTracked}>
            {tracked ? '★ Tracked' : '☆ Track'}
          </button>
          <button className="refresh" onClick={onClose}>
            ✕ Close
          </button>
        </div>
      </div>

      <div className="cards detail-cards">
        <div className="card" title={row ? monthlyTooltip(row, data) : undefined}>
          <div className="card-value">
            {row && row.estMonthlyCredits > 0 ? formatDash(row.estMonthlyCredits, 2) : '—'}
          </div>
          <div className="card-label">Est. monthly earnings</div>
          <div className="card-sub">
            {row && row.estMonthlyCoreCredits > 0
              ? `${formatDash(row.estMonthlyPlatformCredits, 2)} platform + ${formatDash(row.estMonthlyCoreCredits, 2)} core — hover for breakdown`
              : 'platform proposals — hover for breakdown'}
          </div>
        </div>
        <div className="card">
          <div className="card-value">
            {row && row.lastEpochBlocks > 0 ? (
              <>
                {row.lastEpochBlocks} <small>blocks</small>
              </>
            ) : (
              '0'
            )}
          </div>
          <div className="card-label">Last finalized epoch (#{lastEpoch?.index ?? '—'})</div>
          <div className="card-sub">
            {row && row.lastEpochCredits > 0n ? formatDash(row.lastEpochCredits) : 'no payout'}
          </div>
        </div>
        <div className="card" title={eta ? etaTooltip(eta, data, now) : undefined}>
          <div className="card-value">
            {eta ? (
              <>
                ~{etaRemainingBlocks(eta, data, now).toLocaleString()} <small>blocks</small>
              </>
            ) : (
              '—'
            )}
          </div>
          <div className="card-label">Next proposal (est.)</div>
          <div className="card-sub">
            {eta
              ? `after ${eta.rotations} quorum rotation${eta.rotations === 1 ? '' : 's'} — hover for details`
              : row?.inActiveQuorum
                ? 'already proposed in this rotation'
                : 'not in an active quorum — waits for rotation'}
          </div>
        </div>
        <div className="card">
          <div className="card-value">
            {live?.balance != null ? formatDash(live.balance) : '—'}
          </div>
          <div className="card-label">Claimable balance</div>
          <div className="card-sub">
            {live?.balance != null
              ? `${formatCredits(live.balance)} on the node identity`
              : 'identity credits — fetch below'}
          </div>
        </div>
        <div className="card">
          <div className="card-value">
            {live?.currentEpochBlocks != null ? live.currentEpochBlocks : '—'}
          </div>
          <div className="card-label">Blocks this epoch (#{data.currentEpoch.index})</div>
          <div className="card-sub">
            {accrued != null
              ? `≈ ${formatDash(accrued)} accrued at last epoch's rate`
              : 'fetch below'}
          </div>
        </div>
      </div>

      <div className="live-row">
        <button className="primary" onClick={onFetchLive} disabled={liveLoading}>
          {liveLoading
            ? 'Querying platform…'
            : live
              ? 'Refresh balance & current-epoch blocks'
              : 'Fetch balance & current-epoch blocks'}
        </button>
        <span className="muted">
          {live
            ? live.error
              ? `failed: ${live.error}`
              : `fetched ${new Date(live.fetchedAt).toLocaleTimeString()} · 2 platform queries`
            : 'runs 2 platform queries for this node only'}
        </span>
      </div>

      <h3>Blocks proposed per epoch</h3>
      <div className="chart">
        {stats.map(({ epoch, stat }) => (
          <div className="chart-col" key={epoch.index}>
            <div className="chart-value">{stat?.blocks ?? ''}</div>
            <div
              className={`chart-bar ${stat ? '' : 'empty'}`}
              style={{ height: `${((stat?.blocks ?? 0) / maxBlocks) * 120}px` }}
              title={
                stat
                  ? `Epoch ${epoch.index}: ${stat.blocks} blocks (${(stat.share * 100).toFixed(2)}%) → ${formatDash(stat.credits)}`
                  : `Epoch ${epoch.index}: no blocks`
              }
            />
            <div className="chart-label">{epoch.index}</div>
          </div>
        ))}
        {stats.length === 0 && <div className="empty">No finalized epochs in window.</div>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Epoch</th>
              <th>Started</th>
              <th>Blocks</th>
              <th>Share</th>
              <th>Earned (gross)</th>
              <th>Epoch pool</th>
            </tr>
          </thead>
          <tbody>
            {[...stats].reverse().map(({ epoch, stat }) => (
              <tr key={epoch.index}>
                <td>#{epoch.index}</td>
                <td className="muted">{formatDate(epoch.firstBlockTime)}</td>
                <td>{stat?.blocks ?? <span className="muted">0</span>}</td>
                <td>
                  {stat ? `${(stat.share * 100).toFixed(2)}%` : <span className="muted">—</span>}
                </td>
                <td>{stat ? formatDash(stat.credits) : <span className="muted">—</span>}</td>
                <td className="muted">{formatDash(epoch.totalPool, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
