// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OApp, Origin, MessagingFee, MessagingReceipt } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { OAppOptionsType3 } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PostcardOApp
 * @notice Raw LayerZero messaging, no tokens: send a <=140-byte postcard to a
 *         peer OApp and keep the last 50 postcards received. The Stellar side is
 *         contracts/stellar/postcard-oapp; the payload is just UTF-8 bytes.
 */
contract PostcardOApp is OApp, OAppOptionsType3 {
    struct Postcard {
        uint32 srcEid;
        bytes32 sender;
        bytes32 guid;
        string text;
        uint64 timestamp;
    }

    uint16 public constant SEND = 1;
    uint256 public constant MAX_TEXT = 140;
    uint256 public constant MAX_POSTCARDS = 50;

    Postcard[MAX_POSTCARDS] private _ring;
    uint256 private _next;
    uint256 public received;
    uint256 public sent;

    event PostcardSent(bytes32 indexed guid, uint32 indexed dstEid, address indexed from, string text);
    event PostcardReceived(bytes32 indexed guid, uint32 indexed srcEid, bytes32 sender, string text);

    error TooLong(uint256 length);
    error Empty();

    constructor(address _endpoint, address _delegate) OApp(_endpoint, _delegate) Ownable(_delegate) {}

    /// @notice Price a postcard. `_options` are appended to the enforced options for `_dstEid`.
    function quote(uint32 _dstEid, string calldata _text, bytes calldata _options) external view returns (MessagingFee memory) {
        _check(_text);
        return _quote(_dstEid, bytes(_text), combineOptions(_dstEid, SEND, _options), false);
    }

    // snippet:start sendPostcardSol
    /// @notice Send a postcard; msg.value must cover the quoted native fee. Excess is refunded to the sender.
    function sendPostcard(uint32 _dstEid, string calldata _text, bytes calldata _options) external payable returns (MessagingReceipt memory receipt) {
        _check(_text);
        receipt = _lzSend(_dstEid, bytes(_text), combineOptions(_dstEid, SEND, _options), MessagingFee(msg.value, 0), payable(msg.sender));
        sent += 1;
        emit PostcardSent(receipt.guid, _dstEid, msg.sender, _text);
    }
    // snippet:end sendPostcardSol

    /// @notice Postcards received, newest first.
    function postcards() external view returns (Postcard[] memory out) {
        uint256 n = received < MAX_POSTCARDS ? received : MAX_POSTCARDS;
        out = new Postcard[](n);
        for (uint256 i = 0; i < n; i++) {
            // _next points at the slot to write next; the newest is the slot before it.
            uint256 idx = (_next + MAX_POSTCARDS - 1 - i) % MAX_POSTCARDS;
            out[i] = _ring[idx];
        }
    }

    // snippet:start lzReceiveSol
    function _lzReceive(Origin calldata _origin, bytes32 _guid, bytes calldata _message, address, bytes calldata) internal override {
        string memory text = string(_message);
        _ring[_next] = Postcard({ srcEid: _origin.srcEid, sender: _origin.sender, guid: _guid, text: text, timestamp: uint64(block.timestamp) });
        _next = (_next + 1) % MAX_POSTCARDS;
        received += 1;
        emit PostcardReceived(_guid, _origin.srcEid, _origin.sender, text);
    }
    // snippet:end lzReceiveSol

    function _check(string calldata _text) internal pure {
        uint256 len = bytes(_text).length;
        if (len == 0) revert Empty();
        if (len > MAX_TEXT) revert TooLong(len);
    }
}
