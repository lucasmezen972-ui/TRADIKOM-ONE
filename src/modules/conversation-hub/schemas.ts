import { z } from "zod";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const boundedExternalReferenceSchema = z.string().trim().min(1).max(256);
const timestampSchema = z.string().datetime({ offset: true });

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const correlationIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const channelKindSchema = z.enum([
  "web",
  "messaging",
  "email",
  "voice",
  "collaboration",
  "test",
]);

export const confidentialityLevelSchema = z.enum([
  "public",
  "internal",
  "restricted",
  "secret",
]);

export const visibilityScopeSchema = z.enum([
  "personal",
  "team",
  "case",
  "tenant",
]);

export const channelIdentitySchema = z
  .object({
    id: boundedIdentifierSchema,
    tenantId: boundedIdentifierSchema,
    participantId: boundedIdentifierSchema,
    channelKind: channelKindSchema,
    adapterKey: boundedIdentifierSchema,
    externalSubjectId: boundedExternalReferenceSchema,
    displayName: z.string().trim().min(1).max(160).optional(),
    role: z.enum(["customer", "member", "assistant", "system"]),
    state: z.enum(["active", "unverified", "blocked", "revoked"]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((identity, context) => {
    if (Date.parse(identity.updatedAt) < Date.parse(identity.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "La date de mise à jour précède la création.",
        path: ["updatedAt"],
      });
    }
  });

const participantIdentityIdsSchema = z
  .array(boundedIdentifierSchema)
  .min(1)
  .max(100)
  .superRefine((identityIds, context) => {
    if (new Set(identityIds).size !== identityIds.length) {
      context.addIssue({
        code: "custom",
        message: "Un participant ne peut apparaître qu'une fois dans le fil.",
      });
    }
  });

export const canonicalThreadSchema = z
  .object({
    id: boundedIdentifierSchema,
    tenantId: boundedIdentifierSchema,
    status: z.enum(["open", "awaiting_validation", "resolved", "archived"]),
    subject: z.string().trim().min(1).max(200).optional(),
    confidentialityLevel: confidentialityLevelSchema,
    visibilityScope: visibilityScopeSchema,
    participantIdentityIds: participantIdentityIdsSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    lastMessageAt: timestampSchema.optional(),
  })
  .strict()
  .superRefine((thread, context) => {
    const createdAt = Date.parse(thread.createdAt);
    if (Date.parse(thread.updatedAt) < createdAt) {
      context.addIssue({
        code: "custom",
        message: "La date de mise à jour précède la création du fil.",
        path: ["updatedAt"],
      });
    }
    if (thread.lastMessageAt && Date.parse(thread.lastMessageAt) < createdAt) {
      context.addIssue({
        code: "custom",
        message: "Le dernier message ne peut pas précéder le fil.",
        path: ["lastMessageAt"],
      });
    }
  });

export const messageAttachmentSchema = z
  .object({
    id: boundedIdentifierSchema,
    kind: z.enum(["document", "image", "audio", "video", "file"]),
    fileName: z.string().trim().min(1).max(255),
    mediaType: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/),
    sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
    storageReference: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9][A-Za-z0-9/_.:-]*$/),
    checksumSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
  })
  .strict();

export const externalUntrustedDataExtractionSchema = z.discriminatedUnion(
  "integrity",
  [
    z
      .object({
        trustBoundary: z.literal("external_untrusted_data"),
        mode: z.literal("mock"),
        extractorKey: boundedIdentifierSchema,
        integrity: z.literal("verified"),
        text: z.string().min(1).max(16_000),
        extractedAt: timestampSchema,
      })
      .strict(),
    z
      .object({
        trustBoundary: z.literal("external_untrusted_data"),
        integrity: z.literal("failed"),
      })
      .strict(),
  ],
);

export const canonicalMessageAttachmentSchema = messageAttachmentSchema
  .extend({
    extraction: externalUntrustedDataExtractionSchema.optional(),
  })
  .strict();

export const messageRouteHopSchema = z
  .object({
    adapterKey: boundedIdentifierSchema,
    channelIdentityId: boundedIdentifierSchema,
    externalMessageId: boundedExternalReferenceSchema.optional(),
  })
  .strict();

export const messageRouteTraceSchema = z
  .array(messageRouteHopSchema)
  .max(8)
  .superRefine((hops, context) => {
    const visitedRoutes = new Set<string>();
    for (const [index, hop] of hops.entries()) {
      const routeKey = `${hop.adapterKey}:${hop.channelIdentityId}`;
      if (visitedRoutes.has(routeKey)) {
        context.addIssue({
          code: "custom",
          message: "La trace de routage contient une boucle.",
          path: [index],
        });
      }
      visitedRoutes.add(routeKey);
    }
  });

export const messageProvenanceSchema = z
  .object({
    channelIdentityId: boundedIdentifierSchema,
    adapterKey: boundedIdentifierSchema,
    externalMessageId: boundedExternalReferenceSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
    causationId: boundedIdentifierSchema.optional(),
    routeTrace: messageRouteTraceSchema,
  })
  .strict();

const messageContentShape = {
  text: z.string().trim().min(1).max(16_000).optional(),
  attachments: z.array(messageAttachmentSchema).max(10),
};

const canonicalMessageContentShape = {
  text: messageContentShape.text,
  attachments: z.array(canonicalMessageAttachmentSchema).max(10),
};

export const canonicalMessageSchema = z
  .object({
    id: boundedIdentifierSchema,
    tenantId: boundedIdentifierSchema,
    threadId: boundedIdentifierSchema,
    direction: z.enum(["inbound", "outbound", "internal"]),
    kind: z.enum(["text", "system", "plan", "approval", "result"]),
    status: z.enum(["received", "pending", "sent", "delivered", "failed"]),
    ...canonicalMessageContentShape,
    provenance: messageProvenanceSchema,
    occurredAt: timestampSchema,
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((message, context) => {
    if (!message.text && message.attachments.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Un message doit contenir du texte ou une pièce jointe.",
        path: ["text"],
      });
    }
    if (Date.parse(message.createdAt) < Date.parse(message.occurredAt)) {
      context.addIssue({
        code: "custom",
        message: "La création du message précède sa date d'origine.",
        path: ["createdAt"],
      });
    }
  });

export const messageIngressSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    threadId: boundedIdentifierSchema.optional(),
    channelIdentity: channelIdentitySchema,
    externalMessageId: boundedExternalReferenceSchema,
    idempotencyKey: idempotencyKeySchema,
    correlationId: correlationIdSchema,
    causationId: boundedIdentifierSchema.optional(),
    routeTrace: messageRouteTraceSchema,
    ...messageContentShape,
    occurredAt: timestampSchema,
  })
  .strict()
  .superRefine((ingress, context) => {
    if (ingress.channelIdentity.tenantId !== ingress.tenantId) {
      context.addIssue({
        code: "custom",
        message: "L'identité de canal n'appartient pas à ce tenant.",
        path: ["channelIdentity", "tenantId"],
      });
    }
    if (!ingress.text && ingress.attachments.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Un message entrant doit contenir du texte ou une pièce jointe.",
        path: ["text"],
      });
    }
  });

export const conversationThreadLookupSchema = z
  .object({
    threadId: boundedIdentifierSchema,
    messageLimit: z.number().int().min(1).max(200).default(100),
  })
  .strict();

export const conversationThreadListSchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export type ChannelKind = z.infer<typeof channelKindSchema>;
export type ChannelIdentity = z.infer<typeof channelIdentitySchema>;
export type CanonicalThread = z.infer<typeof canonicalThreadSchema>;
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;
export type CanonicalMessageAttachment = z.infer<
  typeof canonicalMessageAttachmentSchema
>;
export type MessageProvenance = z.infer<typeof messageProvenanceSchema>;
export type CanonicalMessage = z.infer<typeof canonicalMessageSchema>;
export type MessageIngress = z.infer<typeof messageIngressSchema>;
export type ConversationThreadLookup = z.infer<
  typeof conversationThreadLookupSchema
>;
export type ConversationThreadList = z.infer<
  typeof conversationThreadListSchema
>;
