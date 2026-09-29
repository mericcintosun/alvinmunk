import { StrKey } from '@stellar/stellar-sdk';

export interface IsStellarAddressOptions {
  /** When false, only classic G… accounts are accepted (e.g. XLM payments). Default true. */
  allowContract?: boolean;
}

/** Validates a Stellar address including checksum (classic G… or Soroban C…). */
export function isStellarAddress(
  s: string,
  { allowContract = true }: IsStellarAddressOptions = {},
): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (StrKey.isValidEd25519PublicKey(trimmed)) return true;
  if (allowContract && StrKey.isValidContract(trimmed)) return true;
  return false;
}
