import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { LocalTestConfiguration, type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

// The local devnet (midnightntwrk/midnight-local-dev, node 0.22.x) uses the
// `undeployed` network id. This must be set before any wallet/provider is built.
export const NETWORK_ID = 'undeployed';
setNetworkId(NETWORK_ID);

// Endpoints of the running local devnet (standalone.yml fixed ports).
export const PORTS = { indexer: 8088, node: 9944, proofServer: 6300 } as const;

// testkit's own config object for the local devnet. It builds the indexer/node/
// proof-server URLs and the Undeployed wallet network id.
export const env: EnvironmentConfiguration = new LocalTestConfiguration(PORTS);

// Genesis mint wallet — holds all NIGHT minted in the genesis block. Used only by
// fund-wallets.ts to bootstrap the sponsor. (Documented in midnight-local-dev.)
export const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

// Sponsor: holds NIGHT, registers it for DUST, pays everyone's fees.
export const SPONSOR_SEED =
  process.env.SPONSOR_SEED ?? '0000000000000000000000000000000000000000000000000000000000000042';

// User: the fee-less party. Must hold ZERO DUST. Never funded.
export const USER_SEED =
  process.env.USER_SEED ?? '0000000000000000000000000000000000000000000000000000000000000099';

// NIGHT transferred from genesis to the sponsor (50,000 NIGHT, matching local-dev).
export const SPONSOR_NIGHT_AMOUNT = 50_000n * 10n ** 6n;

export const SPONSOR_SERVICE_PORT = Number(process.env.SPONSOR_PORT ?? 3001);
export const SPONSOR_SERVICE_URL = `http://localhost:${SPONSOR_SERVICE_PORT}`;

// Default transaction TTL (30 minutes).
export const ttl = () => new Date(Date.now() + 30 * 60 * 1000);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// Absolute path to the compiled Compact output (keys/ + zkir/ live here).
// NodeZkConfigProvider resolves relative paths against process.cwd(), so we make
// it absolute to be safe regardless of where a script is run from.
export const ZK_CONFIG_PATH = path.resolve(repoRoot, 'src', 'managed', 'authorized-action');

export const PRIVATE_STATE_STORE = 'authorized-action-state';
export const PRIVATE_STATE_ID = 'authorized-action';
export const CONTRACT_TAG = 'authorized-action';

// Secrets behind each party's public identity (32 bytes). Local-dev values only.
// The user knows USER_SECRET; the sponsor does not — so the sponsor can pay fees but
// cannot pass the contract's `assert(publicId(secret) == authority)`.
const secret = (byte: number) => new Uint8Array(32).fill(byte);
export const USER_SECRET = secret(0x11);
export const SPONSOR_SECRET = secret(0x22);
export const EMPTY_SECRET = secret(0x00);

// Where deploy.ts records the deployed contract address for the other scripts.
export const DEPLOYED_CONTRACT_FILE = path.resolve(repoRoot, 'deployed-contract.json');
