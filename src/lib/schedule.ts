// Proposer-schedule simulation.
//
// Mirrors drive-abci's validator_set_update_v2 (packages/rs-drive-abci/src/execution/
// platform_events/block_end/validator_set_update/v2/mod.rs in dashpay/platform):
//  - Within the active quorum, Tenderdash walks proposers in ascending raw
//    proTxHash order (equal voting power).
//  - When the last member has proposed, the validator set rotates to the next
//    quorum by index in platform state's quorum ordering, wrapping to 0 and
//    never entering the two oldest quorums when more than 10 exist.
//
// The walk is an estimate: quorum churn at DKG boundaries and missed rounds
// shift the schedule, but under normal operation it holds well.

import { compareBytes } from './grpcweb';
import type { CurrentQuorumsInfo, ProposalEta } from '../types';

export function buildProposalSchedule(
  info: CurrentQuorumsInfo,
  avgBlockTimeMs: number,
): Map<string, ProposalEta> {
  const etas = new Map<string, ProposalEta>();
  const setsByHash = new Map(info.validatorSets.map((vs) => [vs.quorumHashHex, vs]));

  const order = info.quorumHashes.filter((h) => setsByHash.has(h));
  const count = order.length;
  if (count === 0) return etas;

  const currentIndex = Math.max(0, order.indexOf(info.currentQuorumHash));
  // Quorums the rotation may enter (skip the two oldest when >10, as v2 does).
  const rotatableCount = count > 10 ? count - 2 : count;

  let slot = 0;
  const record = (proTxHash: string, quorumHash: string) => {
    slot += 1;
    if (!etas.has(proTxHash)) {
      etas.set(proTxHash, {
        blocks: slot,
        etaMs: slot * avgBlockTimeMs,
        quorumHash,
      });
    }
  };

  // Remaining members of the active quorum, after the last block proposer.
  const current = setsByHash.get(order[currentIndex]);
  if (current) {
    for (const m of current.members) {
      if (m.isBanned) continue;
      if (compareBytes(m.proTxHashBytes, info.lastBlockProposerBytes) > 0) {
        record(m.proTxHash, current.quorumHashHex);
      }
    }
  }

  // Then a full rotation through the remaining quorums.
  let index = currentIndex;
  for (let visited = 0; visited < rotatableCount - 1; visited++) {
    index = index + 1 >= rotatableCount ? 0 : index + 1;
    if (index === currentIndex) continue;
    const vs = setsByHash.get(order[index]);
    if (!vs) continue;
    for (const m of vs.members) {
      if (!m.isBanned) record(m.proTxHash, vs.quorumHashHex);
    }
  }

  return etas;
}
