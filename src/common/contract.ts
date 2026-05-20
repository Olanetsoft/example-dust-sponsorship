import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  initializeMidnightProviders,
  inMemoryPrivateStateProvider,
  type ContractConfiguration,
  type MidnightWalletProvider,
} from '@midnight-ntwrk/testkit-js';
import type { PrivateStateId } from '@midnight-ntwrk/midnight-js-types';
import { Contract, ledger, pureCircuits, type Ledger } from '../managed/authorized-action/contract/index.js';
import { CONTRACT_TAG, env, PRIVATE_STATE_STORE, ZK_CONFIG_PATH } from './config.js';
import { type AuthPrivateState, witnesses } from './witnesses.js';

// A binding to the compiled Compact contract, with the witness implementation and the
// on-disk ZK assets (keys/ + zkir/).
export const compiledContract = CompiledContract.make(CONTRACT_TAG, Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(ZK_CONFIG_PATH),
);

export const contractConfig: ContractConfiguration = {
  privateStateStoreName: PRIVATE_STATE_STORE,
  zkConfigPath: ZK_CONFIG_PATH,
};

// Full provider set (zkConfig, publicData, proof, wallet, midnight, privateState).
// Uses an in-memory private state provider: each process sets its own secret, with no
// on-disk store and no LevelDB locks when several providers are built in one process.
export function buildProviders(walletProvider: MidnightWalletProvider) {
  return {
    ...initializeMidnightProviders<'register' | 'act', AuthPrivateState>(walletProvider, env, contractConfig),
    privateStateProvider: inMemoryPrivateStateProvider<PrivateStateId, AuthPrivateState>(),
  };
}

export { ledger, pureCircuits };
export type { Ledger };
