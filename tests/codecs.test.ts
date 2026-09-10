import { describe, expect, it } from 'vitest';
import { decodeOptions, encodeLzReceiveOption, combineOptions } from '@/lib/layerzero/options';
import { decodePacketHeader } from '@/lib/layerzero/packetHeader';
import { decodeOftMessage, removeDust, conversionRate } from '@/lib/layerzero/oftPayload';
import { evmAddressToBytes32, bytes32ToEvmAddress, bytesToHex } from '@/lib/hex';
import { stellarAddressToHex, bytes32ToStellarCandidates } from '@/lib/stellar/strkey';
import { extractSnippet } from '@/lib/snippets';

// Bytes read from mainnet on 2026-09-10.
const USDT0_ENFORCED_TO_ETHEREUM = '0x00030100110100000000000000000000000000013880';
const ETH_ADAPTER_ENFORCED_TO_STELLAR = '0x0003010011010000000000000000000000000007a120';
const PACKET_HEADER =
  '0x010000000000000020000075950000000000000000000000006c96de32cea08842dcc4058c14d3aaad7fa41dee000077885d672cb21b3afcdda54546c7f5b9fd346920e41f8fe8f39e838e5d7bd7435546';

describe('options type 3', () => {
  it('encodes the lzReceive option exactly like the on-chain enforced options', () => {
    expect(encodeLzReceiveOption(80_000n)).toBe(USDT0_ENFORCED_TO_ETHEREUM);
    expect(encodeLzReceiveOption(500_000n)).toBe(ETH_ADAPTER_ENFORCED_TO_STELLAR);
  });
  it('decodes gas and value', () => {
    const d = decodeOptions(USDT0_ENFORCED_TO_ETHEREUM);
    expect(d.type).toBe(3);
    expect(d.options).toHaveLength(1);
    expect(d.options[0]!.gas).toBe(80_000n);
    expect(d.options[0]!.value).toBeUndefined();
    const withValue = decodeOptions(encodeLzReceiveOption(200_000n, 10n));
    expect(withValue.options[0]!.gas).toBe(200_000n);
    expect(withValue.options[0]!.value).toBe(10n);
  });
  it('combines enforced and extra options by dropping the second type header', () => {
    const combined = combineOptions(encodeLzReceiveOption(80_000n), encodeLzReceiveOption(1n, 5n));
    const d = decodeOptions(combined);
    expect(d.options).toHaveLength(2);
    expect(d.options[1]!.value).toBe(5n);
  });
});

describe('packet header', () => {
  it('decodes a real Ethereum -> Stellar USDT0 header', () => {
    const h = decodePacketHeader(PACKET_HEADER);
    expect(h.version).toBe(1);
    expect(h.nonce).toBe(32n);
    expect(h.srcEid).toBe(30101);
    expect(h.dstEid).toBe(30600);
    expect(bytes32ToEvmAddress(h.sender)).toBe('0x6c96de32cea08842dcc4058c14d3aaad7fa41dee');
    expect(h.receiver).toBe('0x5d672cb21b3afcdda54546c7f5b9fd346920e41f8fe8f39e838e5d7bd7435546');
  });
});

describe('OFT message + dust', () => {
  it('decodes send_to and amount_sd', () => {
    const sendTo = evmAddressToBytes32('0x000000000000000000000000000000000000dead');
    const amount = new Uint8Array(8);
    amount[6] = 0x4c;
    amount[7] = 0x4b;
    const msg = decodeOftMessage(bytesToHex(new Uint8Array([...sendTo, ...amount])));
    expect(bytes32ToEvmAddress(msg.sendTo)).toBe('0x000000000000000000000000000000000000dead');
    expect(msg.amountSd).toBe(0x4c4bn);
    expect(msg.isComposed).toBe(false);
  });
  it('floors 7-decimal amounts to 6 shared decimals', () => {
    const rate = conversionRate(7, 6);
    expect(rate).toBe(10n);
    expect(removeDust(10_000_001n, rate)).toEqual({ sent: 10_000_000n, dust: 1n });
    expect(removeDust(10_000_000_000n, rate)).toEqual({ sent: 10_000_000_000n, dust: 0n });
  });
});

describe('strkey <-> bytes32', () => {
  it('encodes the USDT0 OFT contract id as the hex LayerZero Scan uses', () => {
    expect(stellarAddressToHex('CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6')).toBe(
      '0x5d672cb21b3afcdda54546c7f5b9fd346920e41f8fe8f39e838e5d7bd7435546',
    );
  });
  it('round-trips both candidate readings of a payload', () => {
    const c = bytes32ToStellarCandidates('0x5d672cb21b3afcdda54546c7f5b9fd346920e41f8fe8f39e838e5d7bd7435546');
    expect(c.contract).toBe('CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6');
    expect(c.account.startsWith('G')).toBe(true);
    const issuer = 'GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q';
    expect(bytes32ToStellarCandidates(stellarAddressToHex(issuer)).account).toBe(issuer);
  });
});

describe('snippets', () => {
  it('extracts a marked region', () => {
    const src = 'a\n  // snippet:start x\n  const y = 1;\n  // snippet:end x\nb';
    expect(extractSnippet(src, 'x')).toBe('const y = 1;');
    expect(extractSnippet(src, 'nope')).toContain('not found');
  });
});
