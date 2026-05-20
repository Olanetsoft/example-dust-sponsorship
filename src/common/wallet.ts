import { WebSocket } from 'ws';
// The wallet facade uses apollo GraphQL subscriptions over WebSocket. In Node we
// must provide a WebSocket implementation globally (matches midnight-local-dev).
// @ts-expect-error - assigning the ws implementation to the global
globalThis.WebSocket = WebSocket;

import * as ledger from '@midnight-ntwrk/ledger-v8';
import {
  FluentWalletBuilder,
  MidnightWalletProvider,
  type EnvironmentConfiguration,
} from '@midnight-ntwrk/testkit-js';
import type { Logger } from 'pino';
import * as Rx from 'rxjs';

const NIGHT = ledger.nativeToken().raw;

// MidnightWalletProvider.build() defaults additionalFeeOverhead to 5e20 Specks, larger
// than a freshly-funded local wallet's DUST, so transactions fail with "could not balance
// dust". Use the smaller overhead that midnight-local-dev uses.
const ADDITIONAL_FEE_OVERHEAD = 300_000_000_000_000n;

export interface Balances {
  night: bigint;
  dust: bigint;
}

/**
 * Build a wallet provider from a hex seed and start syncing WITHOUT waiting for
 * funds. (MidnightWalletProvider.start(true) waits for shielded funds via a faucet,
 * which the local devnet does not have — so we always start(false) and wait for
 * sync ourselves.) Returns a synced provider.
 */
export async function buildWallet(
  env: EnvironmentConfiguration,
  seed: string,
  logger: Logger,
  opts: { requireDust?: boolean } = {},
): Promise<MidnightWalletProvider> {
  // Build via FluentWalletBuilder so we can override the dust fee overhead, then
  // wrap in MidnightWalletProvider (which implements WalletProvider for midnight-js).
  const { wallet, seeds, keystore } = await FluentWalletBuilder.forEnvironment(env)
    .withSeed(seed)
    .withDustOptions({
      ledgerParams: ledger.LedgerParameters.initialParameters(),
      additionalFeeOverhead: ADDITIONAL_FEE_OVERHEAD,
      feeBlocksMargin: 5,
    })
    .buildWithoutStarting();

  const provider = await MidnightWalletProvider.withWallet(
    logger,
    env,
    wallet,
    ledger.ZswapSecretKeys.fromSeed(seeds.shielded),
    ledger.DustSecretKey.fromSeed(seeds.dust),
    keystore,
  );

  // start(false): begin syncing without waiting on a (non-existent) faucet.
  await provider.start(false);
  await provider.wallet.waitForSyncedState();
  // Fee-paying wallets must have their DUST balance loaded before they transact.
  if (opts.requireDust) await waitForDust(provider, logger);
  return provider;
}

export function balancesOf(state: { unshielded?: { balances: Record<string, bigint> }; shielded?: { balances: Record<string, bigint> }; dust?: { balance: (d: Date) => bigint } }): Balances {
  const night = (state.unshielded?.balances[NIGHT] ?? 0n) + (state.shielded?.balances[NIGHT] ?? 0n);
  const dust = state.dust?.balance(new Date()) ?? 0n;
  return { night, dust };
}

export async function getBalances(provider: MidnightWalletProvider): Promise<Balances> {
  const state = await Rx.firstValueFrom(provider.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return balancesOf(state);
}

/** Wait until the wallet has synced and holds NIGHT > 0. */
export async function waitForNight(provider: MidnightWalletProvider, logger: Logger): Promise<bigint> {
  return Rx.firstValueFrom(
    provider.wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
      Rx.tap((s) => logger.info(`waiting for NIGHT… current: ${balancesOf(s).night}`)),
      Rx.map((s) => balancesOf(s).night),
      Rx.filter((night) => night > 0n),
    ),
  );
}

/** Wait until the wallet has DUST > 0 (i.e. DUST has been generated after registration). */
export async function waitForDust(provider: MidnightWalletProvider, logger: Logger): Promise<bigint> {
  return Rx.firstValueFrom(
    provider.wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
      Rx.tap((s) => logger.info(`waiting for DUST… current: ${balancesOf(s).dust}`)),
      Rx.map((s) => balancesOf(s).dust),
      Rx.filter((dust) => dust > 0n),
    ),
  );
}

export async function getUnshieldedAddress(provider: MidnightWalletProvider) {
  return provider.wallet.unshielded.getAddress();
}

/**
 * Transfer unshielded NIGHT from `from` to `toAddress`. The sender pays its own
 * DUST fees (default balancing). Returns the submitted transaction identifier.
 */
export async function transferNight(
  from: MidnightWalletProvider,
  toAddress: Awaited<ReturnType<typeof getUnshieldedAddress>>,
  amount: bigint,
): Promise<string> {
  const ttl = new Date(Date.now() + 30 * 60 * 1000);
  const recipe = await from.wallet.transferTransaction(
    [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: toAddress, amount }] }],
    { shieldedSecretKeys: from.zswapSecretKeys, dustSecretKey: from.dustSecretKey },
    { ttl },
  );
  const signed = await from.wallet.signRecipe(recipe, (payload) => from.unshieldedKeystore.signData(payload));
  const finalized = await from.wallet.finalizeRecipe(signed);
  return from.wallet.submitTransaction(finalized);
}

/**
 * Register the wallet's unshielded NIGHT UTXOs for DUST generation, then wait for DUST
 * to appear. Required before a wallet can pay any transaction fees. Mirrors midnight-local-dev.
 */
export async function registerNightForDust(provider: MidnightWalletProvider, logger: Logger): Promise<bigint> {
  const state = await Rx.firstValueFrom(provider.wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  const unregistered = (state.unshielded?.availableCoins ?? []).filter(
    (coin) => coin.meta.registeredForDustGeneration === false,
  );

  if (unregistered.length === 0) {
    const dust = balancesOf(state).dust;
    logger.info(`no unregistered NIGHT UTXOs; current DUST: ${dust}`);
    return dust;
  }

  logger.info(`registering ${unregistered.length} NIGHT UTXO(s) for DUST generation…`);
  const recipe = await provider.wallet.registerNightUtxosForDustGeneration(
    unregistered,
    provider.unshieldedKeystore.getPublicKey(),
    (payload) => provider.unshieldedKeystore.signData(payload),
  );
  const finalized = await provider.wallet.finalizeRecipe(recipe);
  const txId = await provider.wallet.submitTransaction(finalized);
  logger.info(`DUST registration submitted: ${txId}`);

  return waitForDust(provider, logger);
}

export async function shutdown(provider: MidnightWalletProvider): Promise<void> {
  try {
    await provider.wallet.stop();
  } catch {
    // ignore shutdown errors
  }
}
