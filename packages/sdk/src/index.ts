/**
 * @alvinmunk/sdk — a read-only client for alvinmunk reputation, handles and gates.
 *
 * Every method SIMULATES a contract view over Soroban RPC: nothing is signed, paid or
 * submitted, and no key is needed. It is a read-only adapter, never a second write path
 * (belts/00-strategy.md). apps/web reads through this same client, so an integration sees
 * exactly what the app shows.
 *
 * Kept to one module with a single runtime dependency (`@stellar/stellar-sdk`) so the
 * published ESM needs no bundler.
 */
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

// ── Networks ──

export type Network = 'testnet' | 'mainnet';

/** The contracts the client reads. An empty id means "not deployed on this network". */
export interface ContractIds {
  /** Social / Earned XP, vouches */
  reputation: string;
  /** `@handle` ↔ address */
  registry: string;
  /** reputation-gated access */
  gate: string;
}

export interface NetworkDefaults {
  passphrase: string;
  /** Public Soroban RPC. Empty on mainnet: there is no SDF-run one, so pass `rpcUrl`. */
  rpcUrl: string;
  contracts: Readonly<ContractIds>;
}

/** Built-in settings per network: the live testnet deployment. Mainnet ids land at cutover. */
export const NETWORKS: Readonly<Record<Network, Readonly<NetworkDefaults>>> = {
  testnet: {
    passphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    contracts: {
      reputation: 'CBP34OU4D2RN22PVGH5G5EN4HDWHAD5I7VCOLPPB4RD6NMKBJMXY6KT5',
      registry: 'CDRCCUTSOPGJJ5J7FLSW6PBB6R4SKS2F7YUU24GEKJGUEPA2LZH3A23F',
      gate: 'CCOKRQIUL4OY6PTWNAXPC7QKZMJMG2E73UMHGP357XRC6YKGOBUPSSMC',
    },
  },
  mainnet: {
    passphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: '',
    contracts: { reputation: '', registry: '', gate: '' },
  },
};

// ── Encoding / decoding ──

/** ScVal builders for the contract ABIs. */
export const args = {
  addr: (g: string) => new Address(g).toScVal(),
  addrs: (gs: string[]) => xdr.ScVal.scvVec(gs.map((g) => new Address(g).toScVal())),
  u32: (n: number) => nativeToScVal(n, { type: 'u32' }),
  u32s: (ns: number[]) => xdr.ScVal.scvVec(ns.map((n) => nativeToScVal(n, { type: 'u32' }))),
  u64: (n: number | bigint) => nativeToScVal(n, { type: 'u64' }),
  i128: (n: bigint) => nativeToScVal(n, { type: 'i128' }),
  bool: (b: boolean) => xdr.ScVal.scvBool(b),
  str: (s: string) => nativeToScVal(s, { type: 'string' }),
  strs: (ss: string[]) => xdr.ScVal.scvVec(ss.map((s) => nativeToScVal(s, { type: 'string' }))),
  sym: (s: string) => nativeToScVal(s, { type: 'symbol' }),
  // Bytes / BytesN<32> (claim hash, secret) — the host checks fixed length where needed.
  bytes: (u8: Uint8Array) => nativeToScVal(u8, { type: 'bytes' }),
  bytesVec: (u8s: Uint8Array[]) =>
    xdr.ScVal.scvVec(u8s.map((u8) => nativeToScVal(u8, { type: 'bytes' }))),
};

/** An address's reputation — the reputation contract's `Profile`. */
export interface ProfileView {
  /** Social XP: from vouches, never cashable */
  social: number;
  /** Earned XP: from verified quests, the only USDC-eligible track */
  earned: number;
  /** true once the address performed a verified (Earned) action */
  verified: boolean;
}

/** Both XP tracks of an address. */
export interface Scores {
  social: number;
  earned: number;
}

/** A vouch half-card as `get_vouch` returns it. */
export interface VouchView {
  id: number;
  from: string;
  note: string;
  claimed: boolean;
  claimer: string | null;
  /** ledger unix-seconds when the half-card was minted */
  created: number;
  /** Social XP the voucher escrowed (refunded on a timely claim, else slashed) */
  stake: number;
  slashed: boolean;
}

/** Decode a `get_profile` result (native form); missing fields read as 0 / false. */
export function decodeProfile(raw: unknown): ProfileView {
  const p = raw as { social?: bigint; earned?: bigint; verified?: boolean } | null | undefined;
  return {
    social: Number(p?.social ?? 0),
    earned: Number(p?.earned ?? 0),
    verified: Boolean(p?.verified ?? false),
  };
}

/** Decode a `get_vouch` result (native form); `null` for an unknown id. */
export function decodeVouch(raw: unknown): VouchView | null {
  const v = raw as {
    id: bigint;
    from: string;
    note: string;
    claimed: boolean;
    claimer: string | null | undefined;
    created: bigint;
    stake: bigint;
    slashed: boolean;
  } | null | undefined;
  if (!v) return null;
  return {
    id: Number(v.id),
    from: v.from,
    note: v.note,
    claimed: v.claimed,
    claimer: v.claimer ?? null,
    created: Number(v.created),
    stake: Number(v.stake),
    slashed: v.slashed,
  };
}

// ── Simulation ──

/** The only RPC call the client makes. An `rpc.Server` satisfies it; tests pass a stub. */
export type SimulationServer = Pick<rpc.Server, 'simulateTransaction'>;

/**
 * Simulate `method(...callArgs)` on `contractId` and decode what it returns (`undefined`
 * when it returns nothing). A view has no auth and no fee, so the source account need not
 * exist on-chain: a throwaway one forms the envelope unless `source` is given. Throws
 * `simulate <method> failed: <host error>` when the call fails.
 */
export async function simulateRead<T>(
  server: SimulationServer,
  networkPassphrase: string,
  contractId: string,
  method: string,
  callArgs: xdr.ScVal[],
  source: Account = new Account(Keypair.random().publicKey(), '0'),
): Promise<T> {
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...callArgs))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulate ${method} failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  return retval ? (scValToNative(retval) as T) : (undefined as T);
}

/** True when a read failed because the deployed contract has no such function (it
 *  predates that view). */
export function isMissingFunction(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /Error\(WasmVm, MissingValue\)|non-existent contract function/.test(msg);
}

// ── Client ──

export interface ClientOptions {
  network: Network;
  /** Soroban RPC URL; defaults to the network's public one (required on mainnet). */
  rpcUrl?: string;
  /** Override the network passphrase (e.g. a local quickstart network). */
  networkPassphrase?: string;
  /** Override contract ids; an empty string marks a contract as not deployed. */
  contracts?: Partial<ContractIds>;
  /** Reuse an RPC client, or pass a stub in tests. Defaults to one for `rpcUrl`. */
  server?: SimulationServer;
}

/** The read-only client. It has no method that signs, submits or holds a key. */
export interface AlvinmunkClient {
  readonly network: Network;
  readonly networkPassphrase: string;
  readonly rpcUrl: string;
  readonly contracts: Readonly<ContractIds>;
  /** `get_profile(addr)`; on a reputation contract that predates it, the three views it
   *  composes (`get_score`, `get_earned`, `is_verified`). */
  getProfile(address: string): Promise<ProfileView>;
  /** Social and Earned XP of `address`. */
  getScore(address: string): Promise<Scores>;
  /** `@handle` → address; `null` when nobody holds it. */
  resolveHandle(handle: string): Promise<string | null>;
  /** address → `@handle`; `null` when the address holds none. */
  reverseHandle(address: string): Promise<string | null>;
  /** A vouch half-card by id; `null` for an unknown id. */
  getVouch(vouchId: number): Promise<VouchView | null>;
  /** Does `address` pass gate `gateId`? The gate cross-reads reputation on-chain. */
  checkGate(address: string, gateId: number): Promise<boolean>;
}

/**
 * A read-only client for `network`. Every method resolves the view's value or rejects with
 * the RPC / contract error; nothing is retried or cached.
 *
 *   const client = createClient({ network: 'testnet' });
 *   const { social, earned, verified } = await client.getProfile('G…');
 */
export function createClient(options: ClientOptions): AlvinmunkClient {
  const { network } = options;
  const defaults = Object.hasOwn(NETWORKS, network) ? NETWORKS[network] : undefined;
  if (!defaults) {
    throw new Error(`alvinmunk: unknown network "${String(network)}" (expected "testnet" or "mainnet")`);
  }
  const rpcUrl = options.rpcUrl ?? defaults.rpcUrl;
  if (!options.server && !rpcUrl) {
    throw new Error(`alvinmunk: no public RPC is built in for ${network}; pass rpcUrl`);
  }
  const server =
    options.server ?? new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const networkPassphrase = options.networkPassphrase ?? defaults.passphrase;

  const contracts: ContractIds = { ...defaults.contracts };
  for (const key of Object.keys(contracts) as (keyof ContractIds)[]) {
    const id = options.contracts?.[key];
    if (id !== undefined) contracts[key] = id;
  }
  Object.freeze(contracts);

  function read<T>(contract: keyof ContractIds, method: string, callArgs: xdr.ScVal[]): Promise<T> {
    const id = contracts[contract];
    if (!id) {
      return Promise.reject(
        new Error(`alvinmunk: no ${contract} contract on ${network}; pass contracts.${contract}`),
      );
    }
    return simulateRead<T>(server, networkPassphrase, id, method, callArgs);
  }

  async function getProfile(address: string): Promise<ProfileView> {
    const who = args.addr(address);
    try {
      return decodeProfile(await read('reputation', 'get_profile', [who]));
    } catch (e) {
      if (!isMissingFunction(e)) throw e;
      const [social, earned, verified] = await Promise.all([
        read<bigint>('reputation', 'get_score', [who]),
        read<bigint>('reputation', 'get_earned', [who]),
        // A contract older still has no verification at all: nobody is verified there.
        read<boolean>('reputation', 'is_verified', [who]).catch((e2: unknown) => {
          if (isMissingFunction(e2)) return false;
          throw e2;
        }),
      ]);
      return decodeProfile({ social, earned, verified });
    }
  }

  return Object.freeze({
    network,
    networkPassphrase,
    rpcUrl,
    contracts,
    getProfile,
    async getScore(address: string): Promise<Scores> {
      const { social, earned } = await getProfile(address);
      return { social, earned };
    },
    async resolveHandle(handle: string): Promise<string | null> {
      const v = await read<unknown>('registry', 'resolve', [args.sym(handle)]);
      return typeof v === 'string' ? v : null;
    },
    async reverseHandle(address: string): Promise<string | null> {
      const v = await read<unknown>('registry', 'reverse', [args.addr(address)]);
      return typeof v === 'string' ? v : null;
    },
    async getVouch(vouchId: number): Promise<VouchView | null> {
      return decodeVouch(await read('reputation', 'get_vouch', [args.u64(vouchId)]));
    },
    async checkGate(address: string, gateId: number): Promise<boolean> {
      const v = await read<unknown>('gate', 'check', [args.addr(address), args.u32(gateId)]);
      return v === true;
    },
  });
}
