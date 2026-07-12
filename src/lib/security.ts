import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";

export const sessionCookieName = "tradikom_session";
export const tenantCookieName = "tradikom_tenant";

export function nowIso() {
  return new Date().toISOString();
}

export function daysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function secureToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function correlationId() {
  return id("corr");
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown) {
  return JSON.stringify(value);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }

  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");

  if (candidate.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(candidate, expected);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function setSessionCookie(sessionId: string, expiresAt: string) {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookieEnabled(),
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName);
}

export async function getSessionIdFromCookie() {
  const cookieStore = await cookies();
  return cookieStore.get(sessionCookieName)?.value;
}

export async function setTenantCookie(tenantId: string) {
  const cookieStore = await cookies();
  cookieStore.set(tenantCookieName, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookieEnabled(),
    path: "/",
  });
}

export function secureCookieEnabled(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    environment.NODE_ENV === "production" || environment.COOKIE_SECURE === "true"
  );
}

export async function getTenantIdFromCookie() {
  const cookieStore = await cookies();
  return cookieStore.get(tenantCookieName)?.value;
}
