//! Faucet for the mock tUSDT0 on Stellar testnet.
//!
//! The mock mirrors USDT0's real admin model: the issuer is locked, the SAC's
//! admin is a SAC-manager contract, and minting requires MINTER_ROLE on that
//! manager. The deploy script grants MINTER_ROLE to this faucet, so `drip`
//! can call `sac_manager.mint(to, amount, operator = faucet)`. A contract is
//! automatically authorized for its own address, so no key is involved and
//! nothing secret ever reaches the browser.
#![no_std]

use soroban_sdk::{contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address, Env};

#[contractclient(name = "SacManagerClient")]
pub trait SacManager {
    fn mint(env: Env, to: Address, amount: i128, operator: Address);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FaucetError {
    /// This address dripped recently; wait for the cooldown.
    Cooldown = 9101,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Manager,
    Amount,
    CooldownLedgers,
    LastDrip(Address),
}

const PERSISTENT_TTL_THRESHOLD: u32 = 60 * 60 * 24 * 7 / 5; // ~1 week of ledgers
const PERSISTENT_TTL_EXTEND: u32 = 60 * 60 * 24 * 30 / 5; // ~30 days

#[contract]
pub struct Faucet;

#[contractimpl]
impl Faucet {
    pub fn __constructor(env: Env, sac_manager: Address, amount: i128, cooldown_ledgers: u32) {
        env.storage().instance().set(&DataKey::Manager, &sac_manager);
        env.storage().instance().set(&DataKey::Amount, &amount);
        env.storage().instance().set(&DataKey::CooldownLedgers, &cooldown_ledgers);
    }

    /// Mint the configured amount of tUSDT0 to `to`. Anyone may call it; one drip per address per cooldown.
    pub fn drip(env: Env, to: Address) -> i128 {
        let now = env.ledger().sequence();
        let cooldown: u32 = env.storage().instance().get(&DataKey::CooldownLedgers).unwrap_or(0);
        let key = DataKey::LastDrip(to.clone());
        if let Some(last) = env.storage().persistent().get::<DataKey, u32>(&key) {
            if now < last.saturating_add(cooldown) {
                panic_with_error!(&env, FaucetError::Cooldown);
            }
        }
        let manager: Address = env.storage().instance().get(&DataKey::Manager).unwrap();
        let amount: i128 = env.storage().instance().get(&DataKey::Amount).unwrap();
        // operator = this contract: SAC-manager checks MINTER_ROLE for it, and require_auth passes for the calling contract.
        SacManagerClient::new(&env, &manager).mint(&to, &amount, &env.current_contract_address());
        env.storage().persistent().set(&key, &now);
        env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
        env.events().publish((symbol_short!("drip"), to), amount);
        amount
    }

    /// (sac_manager, amount, cooldown_ledgers)
    pub fn config(env: Env) -> (Address, i128, u32) {
        (
            env.storage().instance().get(&DataKey::Manager).unwrap(),
            env.storage().instance().get(&DataKey::Amount).unwrap(),
            env.storage().instance().get(&DataKey::CooldownLedgers).unwrap_or(0),
        )
    }

    /// Ledger sequence from which `to` may drip again (0 = now).
    pub fn next_drip_ledger(env: Env, to: Address) -> u32 {
        let cooldown: u32 = env.storage().instance().get(&DataKey::CooldownLedgers).unwrap_or(0);
        match env.storage().persistent().get::<DataKey, u32>(&DataKey::LastDrip(to)) {
            Some(last) => last.saturating_add(cooldown),
            None => 0,
        }
    }
}
