import type { Witnesses } from '../managed/authorized-action/contract/index.js';

// The prover's private state: the 32-byte secret behind their public identity.
export interface AuthPrivateState {
  readonly secretKey: Uint8Array;
}

export const makePrivateState = (secretKey: Uint8Array): AuthPrivateState => ({ secretKey });

// Witness implementation. The contract only ever uses this value behind an assert
// that binds it to the public `authority`, so a wrong secret cannot authorize an action.
export const witnesses: Witnesses<AuthPrivateState> = {
  secretKey: ({ privateState }) => [privateState, privateState.secretKey],
};
