import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const keyMaterialSchema = z.string().min(32).max(4_096);
const keyVersionSchema = boundedIdentifierSchema.max(80);
const ticketTtlSecondsSchema = z.number().int().min(30).max(300);
const ticketContextSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    userId: boundedIdentifierSchema,
    attachmentId: boundedIdentifierSchema,
  })
  .strict();
const ticketPayloadSchema = z
  .object({
    version: z.literal(1),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
const encryptedTicketSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal("aes-256-gcm"),
    keyVersion: keyVersionSchema,
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    ciphertext: z.string().min(1).max(1_024).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

export type AttachmentAccessTicketContext = z.infer<typeof ticketContextSchema>;

export type AttachmentAccessTicketCodec = {
  readonly mode: "mock";
  readonly keyVersion: string;
  issue(input: {
    context: AttachmentAccessTicketContext;
    now: Date;
    ttlSeconds: number;
  }): { ticket: string; expiresAt: string };
  verify(input: {
    ticket: string;
    context: AttachmentAccessTicketContext;
    now: Date;
  }): { expiresAt: string };
};

export class AttachmentAccessTicketError extends Error {
  constructor(
    readonly code:
      | "attachment_access_ticket_invalid"
      | "attachment_access_ticket_expired",
  ) {
    super("Le lien temporaire de cette pièce jointe n'est pas valide.");
    this.name = "AttachmentAccessTicketError";
  }
}

export function createMockAttachmentAccessTicketCodec(input: {
  keyMaterial: string;
  keyVersion: string;
}): AttachmentAccessTicketCodec {
  try {
    const keyVersion = keyVersionSchema.parse(input.keyVersion);
    const key = deriveKey(keyMaterialSchema.parse(input.keyMaterial), keyVersion);
    return {
      mode: "mock",
      keyVersion,
      issue({ context, now, ttlSeconds }) {
        try {
          const parsedContext = ticketContextSchema.parse(context);
          const parsedTtlSeconds = ticketTtlSecondsSchema.parse(ttlSeconds);
          assertValidDate(now);
          const expiresAt = new Date(
            now.getTime() + parsedTtlSeconds * 1_000,
          ).toISOString();
          const payload = ticketPayloadSchema.parse({
            version: 1,
            nonce: randomBytes(16).toString("base64url"),
            issuedAt: now.toISOString(),
            expiresAt,
          });
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          cipher.setAAD(
            Buffer.from(associatedData(parsedContext, keyVersion), "utf8"),
          );
          const ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(payload), "utf8"),
            cipher.final(),
          ]);
          return {
            ticket: Buffer.from(
              JSON.stringify(
                encryptedTicketSchema.parse({
                  version: 1,
                  algorithm: "aes-256-gcm",
                  keyVersion,
                  iv: iv.toString("base64url"),
                  tag: cipher.getAuthTag().toString("base64url"),
                  ciphertext: ciphertext.toString("base64url"),
                }),
              ),
              "utf8",
            ).toString("base64url"),
            expiresAt,
          };
        } catch {
          throw invalidTicket();
        }
      },
      verify({ ticket, context, now }) {
        try {
          const parsedContext = ticketContextSchema.parse(context);
          assertValidDate(now);
          const envelope = encryptedTicketSchema.parse(
            JSON.parse(Buffer.from(ticket, "base64url").toString("utf8")),
          );
          if (envelope.keyVersion !== keyVersion) {
            throw invalidTicket();
          }
          const decipher = createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(envelope.iv, "base64url"),
          );
          decipher.setAAD(
            Buffer.from(associatedData(parsedContext, keyVersion), "utf8"),
          );
          decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
          const payload = ticketPayloadSchema.parse(
            JSON.parse(
              Buffer.concat([
                decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
                decipher.final(),
              ]).toString("utf8"),
            ),
          );
          const issuedAt = Date.parse(payload.issuedAt);
          const expiresAt = Date.parse(payload.expiresAt);
          const lifetime = expiresAt - issuedAt;
          if (
            issuedAt > now.getTime() ||
            lifetime < 30_000 ||
            lifetime > 300_000
          ) {
            throw invalidTicket();
          }
          if (expiresAt <= now.getTime()) {
            throw new AttachmentAccessTicketError(
              "attachment_access_ticket_expired",
            );
          }
          return { expiresAt: payload.expiresAt };
        } catch (error) {
          if (error instanceof AttachmentAccessTicketError) throw error;
          throw invalidTicket();
        }
      },
    };
  } catch {
    throw invalidTicket();
  }
}

function associatedData(
  context: AttachmentAccessTicketContext,
  keyVersion: string,
) {
  return JSON.stringify([
    "tradikom-conversation-attachment-access-v1",
    keyVersion,
    context.tenantId,
    context.userId,
    context.attachmentId,
  ]);
}

function deriveKey(keyMaterial: string, keyVersion: string) {
  return createHash("sha256")
    .update("tradikom-conversation-attachment-access-key-v1", "utf8")
    .update("\0", "utf8")
    .update(keyVersion, "utf8")
    .update("\0", "utf8")
    .update(keyMaterial, "utf8")
    .digest();
}

function assertValidDate(value: Date) {
  if (!Number.isFinite(value.getTime())) throw invalidTicket();
}

function invalidTicket() {
  return new AttachmentAccessTicketError("attachment_access_ticket_invalid");
}
