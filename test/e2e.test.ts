import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  env,
  PRIVATE_STATE_ID,
  SPONSOR_SECRET,
  SPONSOR_SEED,
  USER_SECRET,
  USER_SEED,
} from '../src/common/config.js';
import { buildProviders, compiledContract, ledger } from '../src/common/contract.js';
import { createLogger } from '../src/common/logger.js';
import { buildWallet, getBalances, shutdown } from '../src/common/wallet.js';
import { makePrivateState } from '../src/common/witnesses.js';
import { deploy } from '../src/deploy.js';
import { fundAll } from '../src/fund-wallets.js';
import { startSponsorService, type SponsorServiceHandle } from '../src/sponsor-service.js';
import { runUser } from '../src/user-client.js';
import { verify } from '../src/verify.js';

const logger = createLogger('e2e');
const TIMEOUT = 15 * 60 * 1000;

let contractAddress: string;
let sponsorService: SponsorServiceHandle;

async function buildAndProveAct(seed: string, secret: Uint8Array) {
  const wallet = await buildWallet(env, seed, logger);
  const providers = buildProviders(wallet);
  providers.privateStateProvider.setContractAddress(contractAddress);
  await providers.privateStateProvider.set(PRIVATE_STATE_ID, makePrivateState(secret));
  const unsubmitted = await createUnprovenCallTx(providers, {
    compiledContract,
    circuitId: 'act',
    contractAddress,
    privateStateId: PRIVATE_STATE_ID,
  });
  const unboundTx = await providers.proofProvider.proveTx(unsubmitted.private.unprovenTx);
  return { wallet, unboundTx };
}

async function waitForActions(min: bigint, timeoutMs = 5 * 60 * 1000): Promise<void> {
  const reader = await buildWallet(env, USER_SEED, logger);
  try {
    const providers = buildProviders(reader);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const st = await providers.publicDataProvider.queryContractState(contractAddress);
      if (st && ledger(st.data).actions >= min) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('timed out waiting for actions counter');
  } finally {
    await shutdown(reader);
  }
}

beforeAll(async () => {
  await fundAll();
  contractAddress = await deploy();
  sponsorService = await startSponsorService();
}, TIMEOUT);

afterAll(async () => {
  await sponsorService?.stop();
});

describe('DUST sponsorship with secret-based authorization', () => {
  it(
    'lets a zero-DUST user register and act, paid by the sponsor; authority is the user, not the sponsor',
    async () => {
      const before = await verify(contractAddress);
      expect(before.matchesUser).toBe(false); // freshly deployed: authority unset

      const { registerTxHash, actTxHash, userDustBefore } = await runUser(contractAddress);
      expect(registerTxHash).toMatch(/^[0-9a-fA-F]+$/);
      expect(actTxHash).toMatch(/^[0-9a-fA-F]+$/);
      expect(userDustBefore).toBe(0n);

      await waitForActions(1n);

      const after = await verify(contractAddress);
      // The registered authority is the user's derived identity, never the sponsor's.
      expect(after.matchesUser).toBe(true);
      expect(after.matchesSponsor).toBe(false);
      expect(after.actions).toBeGreaterThanOrEqual(1n);
      // The user paid nothing: actions ran while the user holds zero DUST and zero NIGHT.
      expect(after.userDust).toBe(0n);
      expect(after.userNight).toBe(0n);

      logger.info(`sponsor DUST (informational): ${before.sponsorDust} -> ${after.sponsorDust}`);
    },
    TIMEOUT,
  );

  it(
    'fails when the zero-DUST user tries to pay for the call themselves',
    async () => {
      const { wallet, unboundTx } = await buildAndProveAct(USER_SEED, USER_SECRET);
      try {
        const { dust } = await getBalances(wallet);
        expect(dust).toBe(0n);
        // Balancing fees with the user's own (zero) DUST must fail.
        await expect(wallet.balanceTx(unboundTx)).rejects.toThrow();
      } finally {
        await shutdown(wallet);
      }
    },
    TIMEOUT,
  );

  it(
    'fails when the sponsor (the fee payer) tries to perform the action — it does not know the secret',
    async () => {
      // The sponsor has DUST, but proving act() with the wrong secret fails the
      // contract's assert(publicId(secret) == authority) before any fee is involved.
      const wallet = await buildWallet(env, SPONSOR_SEED, logger);
      try {
        const providers = buildProviders(wallet);
        providers.privateStateProvider.setContractAddress(contractAddress);
        await providers.privateStateProvider.set(PRIVATE_STATE_ID, makePrivateState(SPONSOR_SECRET));
        await expect(
          (async () => {
            const u = await createUnprovenCallTx(providers, {
              compiledContract,
              circuitId: 'act',
              contractAddress,
              privateStateId: PRIVATE_STATE_ID,
            });
            await providers.proofProvider.proveTx(u.private.unprovenTx);
          })(),
        ).rejects.toThrow();
      } finally {
        await shutdown(wallet);
      }
    },
    TIMEOUT,
  );
});
