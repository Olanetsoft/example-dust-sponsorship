import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { DEPLOYED_CONTRACT_FILE, EMPTY_SECRET, env, PRIVATE_STATE_ID, SPONSOR_SEED } from './common/config.js';
import { buildProviders, compiledContract } from './common/contract.js';
import { createLogger } from './common/logger.js';
import { buildWallet, shutdown } from './common/wallet.js';
import { makePrivateState } from './common/witnesses.js';

const logger = createLogger('deploy');

/**
 * Deploys the authorized-action contract using the sponsor wallet, which holds DUST
 * (deployment is itself a fee-paying transaction). Who deploys the contract is
 * independent of the sponsorship flow. The constructor does not read the witness, so
 * the initial private state is irrelevant; `authority` starts unset (zero).
 */
export async function deploy(): Promise<string> {
  const deployer = await buildWallet(env, SPONSOR_SEED, logger, { requireDust: true });
  try {
    const providers = buildProviders(deployer);
    logger.info('deploying authorized-action contract…');
    const deployed = await deployContract(providers, {
      compiledContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: makePrivateState(EMPTY_SECRET),
    });
    const address = deployed.deployTxData.public.contractAddress;
    fs.writeFileSync(DEPLOYED_CONTRACT_FILE, JSON.stringify({ contractAddress: address }, null, 2));
    logger.info(`contract deployed at ${address}`);
    return address;
  } finally {
    await shutdown(deployer);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  deploy()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(err);
      process.exit(1);
    });
}
