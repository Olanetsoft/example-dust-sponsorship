import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { env, SPONSOR_SECRET, SPONSOR_SEED, USER_SECRET, USER_SEED } from './common/config.js';
import { buildProviders, ledger, pureCircuits } from './common/contract.js';
import { createLogger } from './common/logger.js';
import { buildWallet, getBalances, shutdown } from './common/wallet.js';
import { readContractAddress } from './user-client.js';

const logger = createLogger('verify');

export interface VerifyResult {
  contractAddress: string;
  authorityHex: string;
  userAuthorityHex: string;
  sponsorAuthorityHex: string;
  matchesUser: boolean;
  matchesSponsor: boolean;
  actions: bigint;
  userDust: bigint;
  userNight: bigint;
  sponsorDust: bigint;
}

/**
 * Reads the contract ledger and checks that the registered `authority` equals the
 * USER's derived identity (not the sponsor's), and that the authorized action ran.
 */
export async function verify(contractAddress = readContractAddress()): Promise<VerifyResult> {
  const user = await buildWallet(env, USER_SEED, logger);
  const sponsor = await buildWallet(env, SPONSOR_SEED, logger);
  try {
    const providers = buildProviders(user);
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    if (state === null) throw new Error(`no contract state at ${contractAddress}`);
    const view = ledger(state.data);

    const authorityHex = toHex(view.authority);
    const userAuthorityHex = toHex(pureCircuits.publicId(USER_SECRET));
    const sponsorAuthorityHex = toHex(pureCircuits.publicId(SPONSOR_SECRET));

    const { dust: userDust, night: userNight } = await getBalances(user);
    const { dust: sponsorDust } = await getBalances(sponsor);

    const matchesUser = authorityHex === userAuthorityHex;
    const matchesSponsor = authorityHex === sponsorAuthorityHex;

    logger.info(`authority on chain: ${authorityHex}`);
    logger.info(`user    identity:   ${userAuthorityHex}`);
    logger.info(`sponsor identity:   ${sponsorAuthorityHex}`);
    logger.info(matchesUser ? 'OK authority is the USER identity' : 'MISMATCH: authority is not the user');
    logger.info(`actions: ${view.actions}`);
    logger.info(`user DUST: ${userDust} (expected 0)   sponsor DUST: ${sponsorDust}`);

    return {
      contractAddress,
      authorityHex,
      userAuthorityHex,
      sponsorAuthorityHex,
      matchesUser,
      matchesSponsor,
      actions: view.actions,
      userDust,
      userNight,
      sponsorDust,
    };
  } finally {
    await Promise.all([shutdown(user), shutdown(sponsor)]);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  verify()
    .then((r) => {
      assert(r.matchesUser, 'authority is not the user identity');
      assert(!r.matchesSponsor, 'authority unexpectedly equals the sponsor identity');
      assert(r.actions >= 1n, 'authorized action did not run');
      assert(r.userDust === 0n, `user DUST is ${r.userDust}, expected 0`);
      logger.info('verification passed');
      process.exit(0);
    })
    .catch((err) => {
      logger.error(err);
      process.exit(1);
    });
}
