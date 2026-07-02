# Evonode Payments

Live dashboard of Dash Platform evonode payments: block proposals per epoch,
fee-pool earnings history, claimable identity balance, next block-proposal
estimates, and projected monthly earnings.

**Live:** https://dashpay.github.io/evonode-payments/

## How it works

Dash Platform pays block proposers when an epoch is paid out: each proposer's
identity (identity id = proTxHash) is credited

```
(processing fees + distributed storage fees + core block rewards)
    × proposed_blocks / total_blocks_in_epoch
```

minus any masternode reward shares (`add_epoch_pool_to_proposers_payout_operations`
in `rs-drive-abci`). The dashboard reconstructs this per node and per epoch.

### Data sources — designed to minimize platform load

| Data | Source | Calls per page load |
| --- | --- | --- |
| Evonode list + software versions | `quorums.{net}.networks.dash.org/masternodes` (REST) | 1 (not a platform query) |
| Fee pools + **every** proposer's block count for the last 24 epochs | `getFinalizedEpochInfos` (proof-verified via [@dashevo/evo-sdk](https://www.npmjs.com/package/@dashevo/evo-sdk)) | 1 |
| Current epoch start/index | `getEpochsInfo` | 1 |
| Validator sets for the proposer-ETA walk | `getCurrentQuorumsInfo` (gRPC-Web) | 1 |
| Node identity balance (claimable credits) | `getIdentityBalance` | on button press only |
| Node's blocks in the in-progress epoch | `getEvonodesProposedEpochBlocksByIds` | on button press only |

`getFinalizedEpochInfos` is the workhorse: one call returns, for each epoch,
the full fee pools **and** the complete proposer→block-count map, so the whole
table (history, per-epoch earnings, monthly projections) costs a single
platform query. Per-node queries that can only be made one evonode at a time
(identity balance, current-epoch block count) run only when the user asks.

There is no auto-refresh; ETA countdowns tick locally and a manual Refresh
button re-runs the three load queries.

### Next-proposal estimate

Mirrors drive-abci's `validator_set_update_v2`: Tenderdash walks the active
quorum's members in ascending raw proTxHash order, then rotates to the next
quorum by index (skipping the two oldest when more than 10 exist). ETA = slot ×
average block time over the current epoch. Quorum churn at DKG boundaries
shifts the schedule, so treat it as an estimate.

Earnings figures are **gross** proposer payouts — masternode reward shares
(splits to `payToId` identities) are not subtracted.

## Development

```bash
npm install
npm run dev    # local dev server
npm run build  # production build in dist/
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on push to `main`.
