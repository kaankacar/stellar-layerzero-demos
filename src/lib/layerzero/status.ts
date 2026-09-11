/**
 * Message lifecycle states as reported by the LayerZero Scan API, with the
 * plain-English meaning from LayerZero's debugging guide.
 */
export type MessageStatus =
  | 'INFLIGHT'
  | 'CONFIRMING'
  | 'DELIVERED'
  | 'FAILED'
  | 'BLOCKED'
  | 'PAYLOAD_STORED'
  | 'APPLICATION_BURNED'
  | 'APPLICATION_SKIPPED'
  | 'UNRESOLVABLE_COMMAND'
  | 'MALFORMED_COMMAND';

export type StatusTone = 'progress' | 'success' | 'danger' | 'warning' | 'muted';

export interface StatusInfo {
  label: string;
  tone: StatusTone;
  summary: string;
  detail: string;
  remedy?: string;
}

export const STATUS_INFO: Record<MessageStatus, StatusInfo> = {
  INFLIGHT: {
    label: 'Inflight',
    tone: 'progress',
    summary: 'Waiting for source confirmations, DVN verification, or execution.',
    detail:
      'The source transaction is final or nearly final. Each required DVN independently verifies the packet and submits an attestation on the destination; once all attestations are in, a committer aggregates them and the executor can deliver.',
    remedy:
      'Normal for minutes on mainnet; on testnets the executor alone has taken up to an hour or more. If a DVN lane stays WAITING, that DVN is still waiting for the configured source confirmations (or its testnet indexer is lagging).',
  },
  CONFIRMING: {
    label: 'Confirming',
    tone: 'progress',
    summary: 'The executor submitted the destination transaction; waiting for finality.',
    detail: 'Transitory: the message becomes Delivered once the destination transaction is final.',
  },
  DELIVERED: {
    label: 'Delivered',
    tone: 'success',
    summary: 'lz_receive ran successfully on the destination.',
    detail:
      'For an OFT this means the destination minted or unlocked the tokens. A composed message (lzCompose) may still be pending or fail separately.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'danger',
    summary: 'Delivered to the destination, but execution reverted.',
    detail: 'The destination OApp rejected the message (for example a missing trustline on a Stellar recipient, or an out-of-gas on EVM).',
    remedy: 'Inspect the revert reason on LayerZero Scan, fix the cause, then retry execution (it is permissionless).',
  },
  BLOCKED: {
    label: 'Blocked',
    tone: 'danger',
    summary: 'Configuration prevents progress; needs manual intervention.',
    detail:
      'Common causes: destination OApp has no peer set for the source (NotInitializable), the receiver is not a contract, DVN sets mismatch between source and destination, a dead DVN is configured, or confirmations are misconfigured.',
    remedy: 'Fix the OApp configuration (peers, DVNs, confirmations) on both chains.',
  },
  PAYLOAD_STORED: {
    label: 'Payload stored',
    tone: 'warning',
    summary: 'Verified, but execution failed and the payload was stored for retry.',
    detail: 'The endpoint holds the verified payload; anyone can retry lzReceive once the OApp can accept it.',
    remedy: 'Retry execution after fixing the destination-side issue.',
  },
  APPLICATION_BURNED: {
    label: 'Burned',
    tone: 'muted',
    summary: 'The OApp owner burned this message.',
    detail: 'Used to permanently discard a message that must never execute.',
  },
  APPLICATION_SKIPPED: {
    label: 'Skipped',
    tone: 'muted',
    summary: 'The OApp owner skipped this nonce.',
    detail: 'Ordered-execution OApps skip a nonce to unblock the pathway.',
  },
  UNRESOLVABLE_COMMAND: {
    label: 'Unresolvable command',
    tone: 'danger',
    summary: 'lzRead only: the read command could not be resolved.',
    detail: 'Only applies to lzRead messages.',
  },
  MALFORMED_COMMAND: {
    label: 'Malformed command',
    tone: 'danger',
    summary: 'lzRead only: the read command is malformed.',
    detail: 'Only applies to lzRead messages.',
  },
};

export const ALL_STATUSES = Object.keys(STATUS_INFO) as MessageStatus[];

export function statusInfo(name: string | undefined): StatusInfo {
  return (
    STATUS_INFO[name as MessageStatus] ?? {
      label: name ?? 'Unknown',
      tone: 'muted',
      summary: 'Unrecognised status.',
      detail: '',
    }
  );
}
