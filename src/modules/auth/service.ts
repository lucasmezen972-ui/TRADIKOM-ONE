import type { DbClient } from "@/lib/db";
import {
  daysFromNow,
  hashPassword,
  hashToken,
  id,
  nowIso,
  secureToken,
  verifyPassword,
} from "@/lib/security";
import type { User } from "@/lib/types";
import { AuthError } from "@/modules/auth/errors";
import {
  expireActivePasswordResetTokens,
  findSessionUserByTokenHash,
  findUserByEmail,
  findValidPasswordResetToken,
  insertPasswordResetToken,
  insertSession,
  insertUser,
  revokeActiveSessionsForUser,
  revokeSessionByTokenHash,
  updateUserPasswordHash,
  type UserRow,
} from "@/modules/auth/repository";
import {
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  registrationSchema,
  type LoginInput,
  type PasswordResetInput,
  type PasswordResetRequestInput,
  type RegistrationInput,
} from "@/modules/auth/schemas";
import {
  createDatabaseRateLimiter,
  enforceRateLimit,
  rateLimitPolicies,
} from "@/modules/rate-limit";

export async function registerUser(db: DbClient, input: RegistrationInput) {
  const parsed = registrationSchema.parse(input);
  const email = parsed.email.toLowerCase();
  await enforceRateLimit(db, {
    operationKey: "auth.registration",
    subjectKey: email,
    limit: rateLimitPolicies.registration.limit,
    windowSeconds: rateLimitPolicies.registration.windowSeconds,
  });
  const existing = await findUserByEmail(db, email);

  if (existing) {
    throw new AuthError("account_exists", "Un compte existe deja avec cet email.");
  }

  const createdAt = nowIso();
  const user = {
    id: id("user"),
    name: parsed.name,
    email,
    passwordHash: hashPassword(parsed.password),
    createdAt,
  };

  await insertUser(db, user);

  return mapUser({
    id: user.id,
    name: user.name,
    email: user.email,
    created_at: user.createdAt,
  });
}

export async function loginUser(db: DbClient, input: LoginInput) {
  const parsed = loginSchema.parse(input);
  const email = parsed.email.toLowerCase();
  await enforceRateLimit(db, {
    operationKey: "auth.login",
    subjectKey: email,
    limit: rateLimitPolicies.login.limit,
    windowSeconds: rateLimitPolicies.login.windowSeconds,
  });
  const user = await findUserByEmail(db, email);

  if (!user || !verifyPassword(parsed.password, user.password_hash)) {
    throw new AuthError(
      "invalid_credentials",
      "Email ou mot de passe incorrect.",
    );
  }

  return mapUser(user);
}

export async function createSession(db: DbClient, userId: string) {
  const sessionId = id("sess");
  const sessionToken = secureToken();
  const expiresAt = daysFromNow(14);

  await insertSession(db, {
    id: sessionId,
    userId,
    tokenHash: hashToken(sessionToken),
    expiresAt,
    createdAt: nowIso(),
  });

  return { sessionId, sessionToken, expiresAt };
}

export async function getSessionUser(db: DbClient, sessionToken?: string) {
  if (!sessionToken) {
    return null;
  }

  const row = await findSessionUserByTokenHash(
    db,
    hashToken(sessionToken),
    nowIso(),
  );

  return row
    ? {
        sessionId: row.session_id,
        expiresAt: row.expires_at,
        user: mapUser(row),
      }
    : null;
}

export async function revokeSession(db: DbClient, sessionToken?: string) {
  if (!sessionToken) {
    return;
  }

  await revokeSessionByTokenHash(db, hashToken(sessionToken), nowIso());
}

export async function requestPasswordReset(
  db: DbClient,
  input: PasswordResetRequestInput,
) {
  const parsed = passwordResetRequestSchema.parse(input);
  const email = parsed.email.toLowerCase();
  const rateLimit = await createDatabaseRateLimiter(db).consume({
    operationKey: "auth.password_reset",
    subjectKey: email,
    limit: rateLimitPolicies.passwordReset.limit,
    windowSeconds: rateLimitPolicies.passwordReset.windowSeconds,
  });

  if (!rateLimit.allowed) {
    return { accepted: true };
  }

  const user = await findUserByEmail(db, email);

  if (!user) {
    return { accepted: true };
  }

  const resetToken = secureToken();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await expireActivePasswordResetTokens(db, user.id, now);
  await insertPasswordResetToken(db, {
    id: id("reset"),
    userId: user.id,
    tokenHash: hashToken(resetToken),
    expiresAt,
  });

  return { accepted: true, resetToken, expiresAt, email };
}

export async function resetPassword(db: DbClient, input: PasswordResetInput) {
  const parsed = passwordResetSchema.parse(input);
  const reset = await findValidPasswordResetToken(
    db,
    hashToken(parsed.token),
    nowIso(),
  );

  if (!reset) {
    throw new AuthError(
      "invalid_reset_token",
      "Lien de réinitialisation invalide ou expiré.",
    );
  }

  const now = nowIso();
  await updateUserPasswordHash(db, reset.user_id, hashPassword(parsed.password));
  await expireActivePasswordResetTokens(db, reset.user_id, now);
  await revokeActiveSessionsForUser(db, reset.user_id, now);

  return { userId: reset.user_id };
}

type UserLikeRow = Pick<UserRow, "id" | "name" | "email" | "created_at">;

export function mapUser(row: UserLikeRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}
