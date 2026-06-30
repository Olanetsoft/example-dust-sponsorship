import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  Binding,
  Proof,
  SignatureEnabled,
  Transaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex } from '@midnight-ntwrk/midnight-js-utils';
import { env, SPONSOR_SEED, SPONSOR_SERVICE_PORT, ttl } from './common/config.js';
import { createLogger } from './common/logger.js';
import { buildWallet, getBalances, shutdown } from './common/wallet.js';

const logger = createLogger('sponsor');

export interface SponsorServiceHandle {
  stop: () => Promise<void>;
  port: number;
}

/**
 * Starts the sponsor HTTP service. The sponsor wallet (holds DUST) accepts a
 * proven-but-unbound (PreBinding) transaction from a user, balances ONLY the DUST
 * side (tokenKindsToBalance: ['dust']), signs its own additions, binds, and submits.
 * The sponsor never touches the user's proof or private state.
 */
export async function startSponsorService(port = SPONSOR_SERVICE_PORT): Promise<SponsorServiceHandle> {
  const sponsor = await buildWallet(env, SPONSOR_SEED, logger, { requireDust: true });
  const before = await getBalances(sponsor);
  logger.info(`sponsor ready — NIGHT: ${before.night}  DUST: ${before.dust}`);
  if (before.dust === 0n) {
    logger.warn('sponsor has 0 DUST — balancing will fail. Run `npm run fund` first.');
  }

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/sponsor', async (req, res) => {
    try {
      const { tx } = req.body as { tx?: string };
      if (!tx) {
        res.status(400).json({ success: false, error: 'missing tx' });
        return;
      }

      // The user already proved, signed, and bound their portion: deserialize the
      // finalized (Binding) transaction. The sponsor can only add fees to it.
      const finalizedUserTx = Transaction.deserialize<SignatureEnabled, Proof, Binding>(
        'signature',
        'proof',
        'binding',
        fromHex(tx),
      );

      logger.info('adding DUST fees to the finalized tx…');
      const recipe = await sponsor.wallet.balanceFinalizedTransaction(
        finalizedUserTx,
        { shieldedSecretKeys: sponsor.zswapSecretKeys, dustSecretKey: sponsor.dustSecretKey },
        { ttl: ttl(), tokenKindsToBalance: ['dust'] },
      );

      logger.info('signing sponsor fee additions…');
      const signed = await sponsor.wallet.signRecipe(recipe, (payload) =>
        sponsor.unshieldedKeystore.signData(payload),
      );

      logger.info('finalizing…');
      const finalized = await sponsor.wallet.finalizeRecipe(signed);

      logger.info('submitting…');
      const txHash = await sponsor.wallet.submitTransaction(finalized);
      logger.info(`submitted sponsored tx: ${txHash}`);

      res.json({ success: true, txHash });
    } catch (error) {
      logger.error(`sponsorship failed: ${String(error)}`);
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(port, () => {
      logger.info(`sponsor service listening on http://localhost:${port}`);
      resolve(s);
    });
  });

  return {
    port,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await shutdown(sponsor);
    },
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startSponsorService().catch((err) => {
    logger.error(err);
    process.exit(1);
  });
}
