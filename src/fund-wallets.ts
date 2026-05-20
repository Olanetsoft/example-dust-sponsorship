import { fileURLToPath } from 'node:url';
import {
  env,
  GENESIS_SEED,
  SPONSOR_NIGHT_AMOUNT,
  SPONSOR_SEED,
  USER_SEED,
} from './common/config.js';
import { createLogger } from './common/logger.js';
import {
  buildWallet,
  getBalances,
  getUnshieldedAddress,
  registerNightForDust,
  shutdown,
  transferNight,
  waitForNight,
} from './common/wallet.js';

const logger = createLogger('fund');

export interface FundResult {
  sponsorNight: bigint;
  sponsorDust: bigint;
  userNight: bigint;
  userDust: bigint;
}

/**
 * Funds the sponsor with NIGHT + DUST and leaves the user with zero DUST.
 *
 * Bootstrap order matters: on a fresh `standalone.yml` devnet the genesis wallet
 * holds all minted NIGHT but its DUST is not yet registered. Register it first so
 * the genesis wallet can pay the fee for the NIGHT transfer to the sponsor.
 */
export async function fundAll(): Promise<FundResult> {
  const genesis = await buildWallet(env, GENESIS_SEED, logger, { requireDust: true });
  const sponsor = await buildWallet(env, SPONSOR_SEED, logger);
  const user = await buildWallet(env, USER_SEED, logger);

  try {
    // 1. Genesis: ensure it can pay fees (register its NIGHT for DUST).
    logger.info('ensuring genesis NIGHT is available…');
    await waitForNight(genesis, logger);
    logger.info('registering genesis NIGHT for DUST (bootstrap)…');
    await registerNightForDust(genesis, logger);

    // 2. Transfer NIGHT from genesis to the sponsor.
    const sponsorAddr = await getUnshieldedAddress(sponsor);
    logger.info(`transferring ${SPONSOR_NIGHT_AMOUNT} NIGHT to sponsor…`);
    const txId = await transferNight(genesis, sponsorAddr, SPONSOR_NIGHT_AMOUNT);
    logger.info(`transfer submitted: ${txId}`);

    // 3. Sponsor: wait for NIGHT, then register for DUST.
    logger.info('waiting for sponsor to receive NIGHT…');
    await waitForNight(sponsor, logger);
    logger.info('registering sponsor NIGHT for DUST…');
    await registerNightForDust(sponsor, logger);

    // 4. User: intentionally NOT funded. Must hold zero DUST.
    const sponsorBal = await getBalances(sponsor);
    const userBal = await getBalances(user);

    logger.info(`sponsor NIGHT: ${sponsorBal.night}  DUST: ${sponsorBal.dust}`);
    logger.info(`user    NIGHT: ${userBal.night}  DUST: ${userBal.dust}`);

    if (userBal.dust !== 0n) {
      logger.warn(`user DUST is ${userBal.dust}, expected 0 — the sponsorship premise requires zero user DUST`);
    }

    return {
      sponsorNight: sponsorBal.night,
      sponsorDust: sponsorBal.dust,
      userNight: userBal.night,
      userDust: userBal.dust,
    };
  } finally {
    await Promise.all([shutdown(genesis), shutdown(sponsor), shutdown(user)]);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  fundAll()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(err);
      process.exit(1);
    });
}
