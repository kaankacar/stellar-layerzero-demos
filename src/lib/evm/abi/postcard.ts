import { parseAbi } from 'viem';

export const POSTCARD_ABI = parseAbi([
  'struct Postcard { uint32 srcEid; bytes32 sender; bytes32 guid; string text; uint64 timestamp; }',
  'struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }',
  'struct MessagingReceipt { bytes32 guid; uint64 nonce; MessagingFee fee; }',
  'function quote(uint32 _dstEid, string _text, bytes _options) view returns (MessagingFee)',
  'function sendPostcard(uint32 _dstEid, string _text, bytes _options) payable returns (MessagingReceipt)',
  'function postcards() view returns (Postcard[])',
  'function received() view returns (uint256)',
  'function sent() view returns (uint256)',
  'function peers(uint32 eid) view returns (bytes32)',
  'event PostcardSent(bytes32 indexed guid, uint32 indexed dstEid, address indexed from, string text)',
  'event PostcardReceived(bytes32 indexed guid, uint32 indexed srcEid, bytes32 sender, string text)',
]);
