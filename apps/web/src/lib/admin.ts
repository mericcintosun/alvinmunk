/** The deployed admin address is public configuration, not a client-side secret. */
export function isConfiguredAdmin(address: string): boolean {
  const configured = process.env.NEXT_PUBLIC_ADMIN_ADDRESS;
  return Boolean(configured && address && configured === address);
}
