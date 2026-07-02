import { formatDash, formatDuration } from '../lib/format';
import type { DashboardData } from '../types';

export function Summary({ data, now }: { data: DashboardData; now: number }) {
  const last = data.epochs.length ? data.epochs[data.epochs.length - 1] : null;

  const elapsed = now - data.currentEpoch.firstBlockTime;
  const progress = Math.min(1, Math.max(0, elapsed / data.avgEpochDurationMs));
  const remaining = data.avgEpochDurationMs - elapsed;

  const networkMonthly = data.avgPoolCredits * data.epochsPerMonth;
  const perNodeMonthly = data.activeEvonodes > 0 ? networkMonthly / data.activeEvonodes : 0;

  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="card-value">#{data.currentEpoch.index}</div>
          <div className="card-label">Current epoch</div>
          <div className="card-sub">
            ends {formatDuration(remaining)} — payouts follow the epoch change
          </div>
        </div>
        <div className="card">
          <div className="card-value">{last ? formatDash(last.totalPool, 0) : '—'}</div>
          <div className="card-label">Last epoch pool (#{last?.index ?? '—'})</div>
          <div className="card-sub">
            {last && last.totalBlocks > 0
              ? `${formatDash(last.totalPool / BigInt(last.totalBlocks))} per block · ${last.totalBlocks} blocks`
              : 'fees + core block rewards'}
          </div>
        </div>
        <div className="card good">
          <div className="card-value">{formatDash(networkMonthly, 0)}</div>
          <div className="card-label">Est. network payout / month</div>
          <div className="card-sub">
            avg pool × {data.epochsPerMonth.toFixed(1)} epochs/month
          </div>
        </div>
        <div className="card">
          <div className="card-value">{formatDash(perNodeMonthly, 1)}</div>
          <div className="card-label">Est. average node / month</div>
          <div className="card-sub">gross, before masternode reward shares</div>
        </div>
        <div className="card">
          <div className="card-value">{data.activeEvonodes}</div>
          <div className="card-label">Active evonodes</div>
          <div className="card-sub">
            {last ? `${last.proposerCount} proposed in epoch ${last.index}` : '—'}
          </div>
        </div>
      </div>

      <div className="progress-wrap">
        <div className="progress-labels">
          <span>
            Epoch {data.currentEpoch.index} progress —{' '}
            {new Date(data.currentEpoch.firstBlockTime).toLocaleDateString()} →{' '}
            {new Date(data.currentEpoch.firstBlockTime + data.avgEpochDurationMs).toLocaleDateString()}
          </span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <div className="meta-line">
        <span>height {data.height.toString()}</span>
        <span>avg block time {(data.avgBlockTimeMs / 1000).toFixed(1)}s</span>
        <span>epoch length {formatDuration(data.avgEpochDurationMs)}</span>
        <span>
          history: epochs {data.epochs.length ? data.epochs[0].index : '—'}–
          {data.epochs.length ? data.epochs[data.epochs.length - 1].index : '—'}
        </span>
        <span>{data.proved ? 'proof-verified' : 'unproved fallback'}</span>
      </div>
    </>
  );
}
