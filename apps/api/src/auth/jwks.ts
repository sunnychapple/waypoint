const CACHE_MS = 10 * 60 * 1000;
const UNKNOWN_KID_REFETCH_MS = 60 * 1000;

export function jwksKeySource(
  issuer: string,
  fetchJwks: (url: string) => Promise<unknown>,
  now: () => number,
): (kid: string) => Promise<JsonWebKey | undefined> {
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`;
  let keys = new Map<string, JsonWebKey>();
  let fetchedAt = Number.NEGATIVE_INFINITY;

  const refresh = async (at: number): Promise<void> => {
    fetchedAt = at;
    let body: unknown;
    try {
      body = await fetchJwks(url);
    } catch {
      return;
    }
    const list: unknown[] = typeof body === "object" && body !== null && "keys" in body && Array.isArray(body.keys)
      ? body.keys
      : [];
    const next = new Map<string, JsonWebKey>();
    const isRsaKey = (item: unknown): item is JsonWebKey & { kid: string } =>
      typeof item === "object" && item !== null && "kty" in item && item.kty === "RSA" &&
      "kid" in item && typeof item.kid === "string";
    for (const item of list) {
      if (isRsaKey(item)) next.set(item.kid, item);
    }
    keys = next;
  };

  return async (kid) => {
    const at = now();
    const age = at - fetchedAt;
    if (age >= CACHE_MS || (!keys.has(kid) && age >= UNKNOWN_KID_REFETCH_MS)) {
      await refresh(at);
    }
    return keys.get(kid);
  };
}
