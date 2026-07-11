import type { DbClient } from "@/lib/db";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
};

export type SessionUserRow = {
  session_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  id: string;
  name: string;
  email: string;
  created_at: string;
};

export type PasswordResetTokenRow = {
  id: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
};

export async function findUserByEmail(db: DbClient, email: string) {
  const result = await db.query<UserRow>("select * from users where email = $1", [
    email,
  ]);

  return result.rows[0] ?? null;
}

export async function findUserById(db: DbClient, userId: string) {
  const result = await db.query<UserRow>("select * from users where id = $1", [
    userId,
  ]);

  return result.rows[0] ?? null;
}

export async function insertUser(
  db: DbClient,
  user: {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into users (id, name, email, password_hash, created_at) values ($1, $2, $3, $4, $5)",
    [user.id, user.name, user.email, user.passwordHash, user.createdAt],
  );
}

export async function insertSession(
  db: DbClient,
  session: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) values ($1, $2, $3, $4, $5, $6)",
    [
      session.id,
      session.userId,
      session.tokenHash,
      session.expiresAt,
      null,
      session.createdAt,
    ],
  );
}

export async function findSessionUserByTokenHash(
  db: DbClient,
  tokenHash: string,
  now: string,
) {
  const result = await db.query<SessionUserRow>(
    `select sessions.id as session_id, sessions.token_hash, sessions.expires_at, sessions.revoked_at, users.id, users.name, users.email, users.created_at
     from sessions
     join users on users.id = sessions.user_id
     where sessions.token_hash = $1 and sessions.expires_at > $2 and sessions.revoked_at is null`,
    [tokenHash, now],
  );

  return result.rows[0] ?? null;
}

export async function revokeSessionByTokenHash(
  db: DbClient,
  tokenHash: string,
  revokedAt: string,
) {
  await db.query("update sessions set revoked_at = $1 where token_hash = $2", [
    revokedAt,
    tokenHash,
  ]);
}

export async function revokeActiveSessionsForUser(
  db: DbClient,
  userId: string,
  revokedAt: string,
) {
  await db.query(
    "update sessions set revoked_at = $1 where user_id = $2 and revoked_at is null",
    [revokedAt, userId],
  );
}

export async function expireActivePasswordResetTokens(
  db: DbClient,
  userId: string,
  usedAt: string,
) {
  await db.query(
    "update password_reset_tokens set used_at = $1 where user_id = $2 and used_at is null",
    [usedAt, userId],
  );
}

export async function insertPasswordResetToken(
  db: DbClient,
  token: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
  },
) {
  await db.query(
    "insert into password_reset_tokens (id, user_id, token_hash, expires_at, used_at) values ($1, $2, $3, $4, $5)",
    [token.id, token.userId, token.tokenHash, token.expiresAt, null],
  );
}

export async function findValidPasswordResetToken(
  db: DbClient,
  tokenHash: string,
  now: string,
) {
  const result = await db.query<PasswordResetTokenRow>(
    `select id, user_id, expires_at, used_at
     from password_reset_tokens
     where token_hash = $1 and used_at is null and expires_at > $2`,
    [tokenHash, now],
  );

  return result.rows[0] ?? null;
}

export async function updateUserPasswordHash(
  db: DbClient,
  userId: string,
  passwordHash: string,
) {
  await db.query("update users set password_hash = $1 where id = $2", [
    passwordHash,
    userId,
  ]);
}
