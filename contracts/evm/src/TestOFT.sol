// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestOFT (tUSDT0 on an EVM testnet)
 * @notice The EVM half of the mock pathway. A plain LayerZero OFT: the contract
 *         is both the ERC20 and the OApp. Sending burns here and mints on Stellar
 *         (through the SAC-manager); receiving mints here.
 *
 *         decimals() is 6 so that local decimals == shared decimals (6) and the
 *         conversion rate is 1, mirroring USDT on Ethereum. Stellar's side has
 *         7 local decimals and floors dust before sending.
 *
 *         This is a MOCK for the testnet playground. The real USDT0 lives on
 *         mainnet only.
 */
contract TestOFT is OFT {
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _delegate
    ) OFT(_name, _symbol, _lzEndpoint, _delegate) Ownable(_delegate) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // snippet:start evmFaucetSol
    /// @notice Testnet-only faucet: 1,000 tUSDT0 to the caller, once per hour. Mirrors the Stellar Faucet
    ///         contract so a MetaMask-only user can try the compose page without a Stellar wallet.
    ///         Like the Stellar faucet it mints out of thin air, so the mock's supply is not bridged supply.
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** 6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    mapping(address => uint256) public lastDrip;
    event Drip(address indexed to, uint256 amount);

    function faucet() external {
        require(block.timestamp >= lastDrip[msg.sender] + FAUCET_COOLDOWN, "faucet: cooldown");
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Drip(msg.sender, FAUCET_AMOUNT);
    }
    // snippet:end evmFaucetSol
}
