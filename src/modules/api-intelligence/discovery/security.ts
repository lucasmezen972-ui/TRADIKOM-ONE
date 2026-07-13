import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DiscoveryError } from "@/modules/api-intelligence/discovery/errors";

export type DiscoveryDnsLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export function validateDiscoveryUrl(value: string, approvedDomain: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    hostname !== approvedDomain
  ) {
    throw new DiscoveryError(
      "url_not_allowed",
      "URL de decouverte non autorisee.",
    );
  }
  if (isPrivateHostname(hostname)) {
    throw new DiscoveryError(
      "private_address_blocked",
      "Adresse reseau privee interdite.",
    );
  }
  return url;
}

export async function resolvePublicDiscoveryAddress(
  hostname: string,
  lookupImpl: DiscoveryDnsLookup = defaultDnsLookup,
) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  const addresses = family
    ? [{ address: normalized, family }]
    : await lookupImpl(normalized);
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateAddress(entry.address))
  ) {
    throw new DiscoveryError(
      "private_address_blocked",
      "Resolution DNS non autorisee.",
    );
  }
  return addresses[0]!;
}

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    const hexadecimal = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexadecimal) {
      const high = Number.parseInt(hexadecimal[1]!, 16);
      const low = Number.parseInt(hexadecimal[2]!, 16);
      return isPrivateAddress(
        `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
      );
    }
    return isPrivateAddress(mapped);
  }
  if (isIP(normalized) === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("64:ff9b:") ||
      normalized.startsWith("2001:0:") ||
      normalized.startsWith("2001:db8:") ||
      normalized.startsWith("2002:")
    );
  }
  const parts = normalized.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
    (parts[0] === 192 && parts[1] === 0) ||
    (parts[0] === 192 && parts[1] === 88 && parts[2] === 99) ||
    (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
    parts[0]! >= 224
  );
}

function isPrivateHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (isIP(hostname) !== 0 && isPrivateAddress(hostname))
  );
}

async function defaultDnsLookup(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}
