import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import {
  DEPLOYED_CONTRACT_FILE,
  env,
  PRIVATE_STATE_ID,
  SPONSOR_SERVICE_URL,
  USER_SECRET,
  USER_SEED,
} from './common/config.js';
import { buildProviders, compiledContract, ledger } from './common/contract.js';
import { createLogger } from './common/logger.js';
import { buildWallet, getBalances, shutdown } from './common/wallet.js';
import { makePrivateState } from './common/witnesses.js';

const logger = createLogger('user');

type Providers = ReturnType<typeof buildProviders>;
type CircuitId = 'register' | 'act';

export interface UserRunResult {
  registerTxHash: string;
  actTxHash: string;
  userDustBefore: bigint;
}

export function readContractAddress(): string {
  return JSON.parse(fs.readFileSync(DEPLOYED_CONTRACT_FILE, 'utf-8')).contractAddress as string;
}

const isZero = (b: Uint8Array) => b.every((x) => x === 0);

/**
 * Build + prove one circuit call (no DUST inputs) and hand the proven-but-unbound
 * (PreBinding) transaction to the sponsor, which balances DUST and submits it.
 */
export async function sponsoredCall(
  providers: Providers,
  contractAddress: string,
  circuitId: CircuitId,
): Promise<string> {
  logger.info(`building + proving ${circuitId}() (user is the prover)…`);
  const unsubmitted = await createUnprovenCallTx(providers, {
    compiledContract,
    circuitId,
    contractAddress,
    privateStateId: PRIVATE_STATE_ID,
  });
  const unboundTx = await providers.proofProvider.proveTx(unsubmitted.private.unprovenTx);
  const hex = toHex(unboundTx.serialize());

  const res = await fetch(`${SPONSOR_SERVICE_URL}/sponsor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx: hex }),
  });
  const json = (await res.json()) as { success: boolean; txHash?: string; error?: string };
  if (!res.ok || !json.success || !json.txHash) {
    throw new Error(`sponsor rejected ${circuitId}: ${json.error ?? res.statusText}`);
  }
  logger.info(`${circuitId}() sponsored tx hash: ${json.txHash}`);
  return json.txHash;
}

/** Poll the indexer until the contract's `authority` is set (non-zero). */
export async function waitForAuthority(
  providers: Providers,
  contractAddress: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await providers.publicDataProvider.queryContractState(contractAddress);
    if (st && !isZero(ledger(st.data).authority)) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('timed out waiting for authority to be registered');
}

/**
 * Full user flow: register the user's identity as the authority, then perform an
 * authorized action — both proven by the user and paid for by the sponsor. The user
 * holds zero DUST throughout.
 */
export async function runUser(contractAddress: string): Promise<UserRunResult> {
  const user = await buildWallet(env, USER_SEED, logger);
  try {
    const providers = buildProviders(user);
    // The prover's secret lives in private state; the witness reads it from here.
    // Private state is scoped per contract address, so set that scope first.
    providers.privateStateProvider.setContractAddress(contractAddress);
    await providers.privateStateProvider.set(PRIVATE_STATE_ID, makePrivateState(USER_SECRET));

    const { dust: userDustBefore } = await getBalances(user);
    logger.info(`user DUST before: ${userDustBefore} (expected 0)`);

    const registerTxHash = await sponsoredCall(providers, contractAddress, 'register');
    // act() proves against the on-chain authority, so wait until register is indexed.
    await waitForAuthority(providers, contractAddress);
    const actTxHash = await sponsoredCall(providers, contractAddress, 'act');

    return { registerTxHash, actTxHash, userDustBefore };
  } finally {
    await shutdown(user);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runUser(readContractAddress())
    .then((r) => {
      logger.info(`done: ${JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
      process.exit(0);
    })
    .catch((err) => {
      logger.error(err);
      process.exit(1);
    });
}
