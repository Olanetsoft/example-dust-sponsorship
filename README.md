# Midnight DUST Sponsorship Example

A working example of **fee sponsorship** on Midnight: one wallet (the **sponsor**) pays
the DUST transaction fees for another wallet (the **user**) that holds zero DUST. A
contract call from the user's identity lands on-chain, with fees paid by the sponsor.

Crucially, it shows that sponsorship separates **who pays** from **who is authorized**.
The contract authorizes a caller by proving knowledge of a secret
(`assert(publicId(secret) == authority)`). The user proves this and runs the action; the
sponsor pays the fee but **cannot** perform the action, because it does not know the
secret. (This avoids `ownPublicKey()` for authorization — the
[security docs](https://docs.midnight.network/compact/smart-contract-security) warn it is
a prover-controlled witness and must not be trusted as an authenticated caller.)

## How it works

```
                 user wallet (0 DUST)                         sponsor wallet (has DUST)
  ┌──────────────────────────────────────┐        ┌────────────────────────────────────┐
  │ createUnprovenCallTx(register / act)  │        │ POST /sponsor { tx }                 │
  │   → unprovenTx (proves it knows the   │        │ Transaction.deserialize(pre-binding) │
  │      secret behind `authority`)       │        │ balanceUnboundTransaction(['dust'])  │
  │ proofProvider.proveTx(unprovenTx)     │  hex   │ signRecipe(sponsor sig)              │
  │   → UnboundTransaction (PreBinding) ──┼───────▶│ finalizeRecipe()  (binds)            │
  │                                       │        │ submitTransaction()  → txHash        │
  └──────────────────────────────────────┘        └────────────────────────────────────┘
```

The user is always the prover, so the sponsor never sees the user's private state (its
secret). The handoff happens in the `PreBinding` state (proven, not yet bound) — the
wallet engine only allows balancing a transaction that has not yet been bound.

## Prerequisites

- Node.js **≥ 22** (the SDK does not support Node 20). A `.nvmrc` is included: `nvm use`.
- Docker + Docker Compose v2 (for the local devnet).
- A local devnet from
  [`midnightntwrk/midnight-local-dev`](https://github.com/midnightntwrk/midnight-local-dev)
  on the standard ports: node `9944`, indexer `8088`, proof server `6300`, network id
  `undeployed`.

Start the devnet:

```bash
git clone https://github.com/midnightntwrk/midnight-local-dev
cd midnight-local-dev && npm install
docker compose -f standalone.yml up -d
```

## Setup

```bash
nvm use                  # Node 22
npm install
npm run build:contract   # contracts/authorized-action.compact → src/managed/authorized-action
```

## Running

Full flow as a test (fund → deploy → sponsor → user register + act → verify, plus two
negative cases):

```bash
npm run e2e
```

Or step by step, in order:

```bash
npm run fund     # fund the sponsor with NIGHT + DUST; the user is left with zero DUST
npm run deploy   # deploy authorized-action, writing deployed-contract.json
npm run sponsor  # start the sponsor HTTP service on :3001 (leave running)
npm run user     # prove register() then act() as the user; hand each to the sponsor
npm run verify   # assert authority == user identity (not sponsor) and user DUST == 0
```
