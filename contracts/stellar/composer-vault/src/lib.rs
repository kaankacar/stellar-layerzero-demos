//! ComposerVault: a Stellar application whose only users hold an EVM wallet.
//!
//! Deposit: on the EVM side, `OFT.send` names this contract as the recipient
//! (`to` = its 32-byte contract id) and carries a `composeMsg`. On Stellar the
//! OFT mints the tUSDT0 to this contract, then hands the endpoint a compose
//! message; the executor (or anyone, see below) calls `lz_compose` here. We
//! prove the message is genuine by asking the endpoint to `clear_compose` it
//! (the endpoint only clears what the OFT really queued, exactly once), decode
//! the standard OFT compose payload and credit `amount_ld` to the 20-byte EVM
//! address that sent it. The `composeMsg` bytes are kept as a note.
//!
//! Withdraw: the EVM key signs a 32-byte digest with `personal_sign`
//! (EIP-191). `withdraw` recomputes the digest from the arguments and the
//! current nonce, recovers the signer with `secp256k1_recover`, checks it is
//! the credited address, and transfers tUSDT0 to any Stellar G or C address.
//! Whoever submits the Stellar transaction pays the fee; the signature is the
//! authorization. `withdraw_digest` returns the exact bytes to sign, so the
//! browser never re-implements the hashing.
//!
//! `lz_compose` does not require the executor's auth on purpose: like
//! `lz_receive`, delivery is permissionless once the message is queued.
#![no_std]

use endpoint_v2::MessagingComposerClient;
use oft_core::oft_compose_msg_codec::OFTComposeMsg;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token::TokenClient, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec,
};

/// Notes longer than this are cut; a postcard-sized note is plenty.
pub const MAX_NOTE_LEN: u32 = 140;
/// How many deposits the `deposits()` view keeps, newest first.
pub const MAX_DEPOSITS: u32 = 50;
/// Domain separator for withdrawal digests (prevents a signature from being replayed against another app).
const WITHDRAW_DOMAIN: &[u8] = b"stellar-layerzero-demos/composer-vault/withdraw/v1";
/// EIP-191 prefix that `personal_sign` puts in front of a 32-byte message.
const ETH_PREFIX_32: &[u8] = b"\x19Ethereum Signed Message:\n32";

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    /// The compose message did not come from the OFT this vault was built for.
    NotOft = 9101,
    /// The signature does not recover to the EVM address being debited.
    BadSignature = 9102,
    /// The EVM address has less than the requested amount.
    Insufficient = 9103,
    /// Amount must be positive.
    BadAmount = 9104,
    /// The compose payload was shorter than the OFT compose header.
    BadPayload = 9105,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposit {
    pub guid: BytesN<32>,
    pub src_eid: u32,
    /// The EVM address that called `send` on the source chain (last 20 bytes of `compose_from`).
    pub from: BytesN<20>,
    /// Amount credited, in Stellar local decimals (7).
    pub amount: i128,
    /// The `composeMsg` bytes, cut to 140.
    pub note: Bytes,
    pub ledger: u32,
    pub timestamp: u64,
}

/// Emitted by `lz_compose` once a deposit is credited.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    #[topic]
    pub evm: BytesN<20>,
    pub guid: BytesN<32>,
    pub amount: i128,
    pub note: Bytes,
}

/// Emitted by `withdraw` once the token transfer went through.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub evm: BytesN<20>,
    pub to: Address,
    pub amount: i128,
    pub nonce: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Endpoint,
    Oft,
    Token,
    Deposits,
    Count,
    Balance(BytesN<20>),
    Nonce(BytesN<20>),
}

#[contract]
pub struct ComposerVault;

#[contractimpl]
impl ComposerVault {
    /// `endpoint` is LayerZero's EndpointV2, `oft` the OFT whose compose messages we accept, `token` that OFT's token (the SAC).
    pub fn __constructor(env: &Env, endpoint: Address, oft: Address, token: Address) {
        env.storage().instance().set(&DataKey::Endpoint, &endpoint);
        env.storage().instance().set(&DataKey::Oft, &oft);
        env.storage().instance().set(&DataKey::Token, &token);
    }

    // snippet:start lzComposeRust
    /// Called by the executor (or anyone) after the OFT delivered tokens to this contract with a compose message.
    /// Signature is LayerZero's `ILayerZeroComposer::lz_compose`.
    pub fn lz_compose(env: &Env, _executor: Address, from: Address, guid: BytesN<32>, index: u32, message: Bytes, _extra_data: Bytes, _value: i128) {
        let oft: Address = env.storage().instance().get(&DataKey::Oft).unwrap();
        if from != oft {
            panic_with_error!(env, VaultError::NotOft);
        }
        // The endpoint checks that `from` queued exactly this message for us (hash match) and clears it, so a
        // compose can be executed once and cannot be forged. This is the whole authenticity check.
        let endpoint: Address = env.storage().instance().get(&DataKey::Endpoint).unwrap();
        MessagingComposerClient::new(env, &endpoint).clear_compose(&env.current_contract_address(), &from, &guid, &index, &message);

        // [nonce u64][src_eid u32][amount_ld i128][compose_from 32 bytes][compose_msg …]
        if message.len() < 60 {
            panic_with_error!(env, VaultError::BadPayload);
        }
        let m = OFTComposeMsg::decode(&message);
        let evm = evm_address(env, &m.compose_from);
        let note = if m.compose_msg.len() > MAX_NOTE_LEN { m.compose_msg.slice(0..MAX_NOTE_LEN) } else { m.compose_msg.clone() };

        let key = DataKey::Balance(evm.clone());
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(balance + m.amount_ld));

        let deposit = Deposit { guid: guid.clone(), src_eid: m.src_eid, from: evm.clone(), amount: m.amount_ld, note: note.clone(), ledger: env.ledger().sequence(), timestamp: env.ledger().timestamp() };
        let mut deposits: Vec<Deposit> = env.storage().instance().get(&DataKey::Deposits).unwrap_or(Vec::new(env));
        deposits.push_front(deposit);
        while deposits.len() > MAX_DEPOSITS {
            deposits.pop_back();
        }
        env.storage().instance().set(&DataKey::Deposits, &deposits);
        let count: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        env.storage().instance().set(&DataKey::Count, &(count + 1));
        Deposited { evm, guid, amount: m.amount_ld, note }.publish(env);
    }
    // snippet:end lzComposeRust

    // snippet:start withdrawRust
    /// The 32 bytes the EVM key must sign (with `personal_sign`) to move `amount` to `to`. Includes the current nonce.
    pub fn withdraw_digest(env: &Env, evm: BytesN<20>, to: Address, amount: i128) -> BytesN<32> {
        let nonce: u64 = env.storage().persistent().get(&DataKey::Nonce(evm.clone())).unwrap_or(0);
        digest(env, &evm, &to, amount, nonce)
    }

    /// Move `amount` of the vault's token from `evm`'s balance to `to`, authorized by an EIP-191 signature over
    /// `withdraw_digest(evm, to, amount)`. Anyone may submit; the signature and the nonce make it safe.
    pub fn withdraw(env: &Env, evm: BytesN<20>, to: Address, amount: i128, signature: BytesN<65>) {
        if amount <= 0 {
            panic_with_error!(env, VaultError::BadAmount);
        }
        let nonce_key = DataKey::Nonce(evm.clone());
        let nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0);
        let digest = digest(env, &evm, &to, amount, nonce);

        // personal_sign hashes "\x19Ethereum Signed Message:\n32" + digest; recover the signer from that.
        let mut prefixed = Bytes::from_slice(env, ETH_PREFIX_32);
        prefixed.append(&Bytes::from(digest));
        let eth_hash = env.crypto().keccak256(&prefixed);
        let sig_bytes = Bytes::from(signature.clone());
        let rs: BytesN<64> = sig_bytes.slice(0..64).try_into().unwrap();
        let v = sig_bytes.get(64).unwrap() as u32;
        let recovery_id = if v >= 27 { v - 27 } else { v };
        let pubkey = env.crypto().secp256k1_recover(&eth_hash, &rs, recovery_id);
        // Ethereum address = last 20 bytes of keccak256(uncompressed pubkey without the 0x04 prefix).
        let addr = env.crypto().keccak256(&Bytes::from(pubkey).slice(1..65)).to_bytes();
        if Bytes::from(addr).slice(12..32) != Bytes::from(evm.clone()) {
            panic_with_error!(env, VaultError::BadSignature);
        }

        let bal_key = DataKey::Balance(evm.clone());
        let balance: i128 = env.storage().persistent().get(&bal_key).unwrap_or(0);
        if balance < amount {
            panic_with_error!(env, VaultError::Insufficient);
        }
        env.storage().persistent().set(&bal_key, &(balance - amount));
        env.storage().persistent().set(&nonce_key, &(nonce + 1));

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        TokenClient::new(env, &token).transfer(&env.current_contract_address(), &to, &amount);
        Withdrawn { evm, to, amount, nonce }.publish(env);
    }
    // snippet:end withdrawRust

    /// Credited balance of an EVM address, in local decimals (7).
    pub fn balance(env: &Env, evm: BytesN<20>) -> i128 {
        env.storage().persistent().get(&DataKey::Balance(evm)).unwrap_or(0)
    }

    /// Withdrawals signed so far by an EVM address (the next digest uses this value).
    pub fn nonce(env: &Env, evm: BytesN<20>) -> u64 {
        env.storage().persistent().get(&DataKey::Nonce(evm)).unwrap_or(0)
    }

    /// The last 50 deposits, newest first.
    pub fn deposits(env: &Env) -> Vec<Deposit> {
        env.storage().instance().get(&DataKey::Deposits).unwrap_or(Vec::new(env))
    }

    /// Total number of deposits ever credited.
    pub fn count(env: &Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// (endpoint, oft, token) this vault was constructed with.
    pub fn config(env: &Env) -> (Address, Address, Address) {
        (
            env.storage().instance().get(&DataKey::Endpoint).unwrap(),
            env.storage().instance().get(&DataKey::Oft).unwrap(),
            env.storage().instance().get(&DataKey::Token).unwrap(),
        )
    }
}

/// The 20-byte EVM address inside a left-padded 32-byte LayerZero address.
fn evm_address(env: &Env, from: &BytesN<32>) -> BytesN<20> {
    let bytes = Bytes::from(from.clone()).slice(12..32);
    match BytesN::<20>::try_from(bytes) {
        Ok(b) => b,
        Err(_) => panic_with_error!(env, VaultError::BadPayload),
    }
}

/// keccak256(domain ‖ this contract (XDR) ‖ evm ‖ nonce BE ‖ amount BE ‖ to (XDR)).
fn digest(env: &Env, evm: &BytesN<20>, to: &Address, amount: i128, nonce: u64) -> BytesN<32> {
    let mut b = Bytes::from_slice(env, WITHDRAW_DOMAIN);
    b.append(&env.current_contract_address().to_xdr(env));
    b.append(&Bytes::from(evm.clone()));
    b.extend_from_slice(&nonce.to_be_bytes());
    b.extend_from_slice(&amount.to_be_bytes());
    b.append(&to.clone().to_xdr(env));
    env.crypto().keccak256(&b).to_bytes()
}
