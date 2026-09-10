import { parseAbi } from 'viem';

/** The subset of the LayerZero OFT (IOFT + OAppCore + ERC20) interface this site calls. */
export const OFT_ABI = parseAbi([
  'struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }',
  'struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }',
  'struct OFTLimit { uint256 minAmountLD; uint256 maxAmountLD; }',
  'struct OFTFeeDetail { int256 feeAmountLD; string description; }',
  'struct OFTReceipt { uint256 amountSentLD; uint256 amountReceivedLD; }',
  'struct MessagingReceipt { bytes32 guid; uint64 nonce; MessagingFee fee; }',
  'function quoteOFT(SendParam _sendParam) view returns (OFTLimit, OFTFeeDetail[], OFTReceipt)',
  'function quoteSend(SendParam _sendParam, bool _payInLzToken) view returns (MessagingFee)',
  'function send(SendParam _sendParam, MessagingFee _fee, address _refundAddress) payable returns (MessagingReceipt, OFTReceipt)',
  'function peers(uint32 eid) view returns (bytes32)',
  'function enforcedOptions(uint32 eid, uint16 msgType) view returns (bytes)',
  'function token() view returns (address)',
  'function sharedDecimals() view returns (uint8)',
  'function decimalConversionRate() view returns (uint256)',
  'function approvalRequired() view returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function owner() view returns (address)',
  'function endpoint() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'event OFTSent(bytes32 indexed guid, uint32 dstEid, address indexed fromAddress, uint256 amountSentLD, uint256 amountReceivedLD)',
  'event OFTReceived(bytes32 indexed guid, uint32 srcEid, address indexed toAddress, uint256 amountReceivedLD)',
]);
