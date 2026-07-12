import { z } from "zod";

type EnvironmentInput = Record<string, string | undefined>;

const booleanString = z.enum(["true", "false"]);
const positiveIntegerString = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => Number(value) > 0 && Number.isSafeInteger(Number(value)));

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z
      .string()
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
      .optional(),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) =>
        ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      )
      .optional(),
    DATABASE_POOL_MAX: positiveIntegerString.optional(),
    PGLITE_DATA_DIR: z.string().min(1).optional(),
    CONNECTOR_ENCRYPTION_KEY: z.string().min(32).optional(),
    EMAIL_PROVIDER: z.enum(["console", "test"]).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_MODEL: z.string().min(1).optional(),
    FEATURE_PUBLIC_DEMO: booleanString.optional(),
    FEATURE_AUTH_LINK_PREVIEW: booleanString.optional(),
    FEATURE_LIVE_INTEGRATIONS: booleanString.optional(),
    FEATURE_AI_GENERATION: booleanString.optional(),
    ALLOW_CONSOLE_EMAIL_IN_PRODUCTION: booleanString.optional(),
    COOKIE_SECURE: booleanString.optional(),
    WORKER_MODE: z.enum(["once", "poll"]).optional(),
    WORKER_BATCH_SIZE: positiveIntegerString.optional(),
    WORKER_POLL_INTERVAL_MS: positiveIntegerString.optional(),
    WORKER_INTERVAL_MS: positiveIntegerString.optional(),
    MAINTENANCE_BATCH_SIZE: positiveIntegerString.optional(),
  })
  .passthrough()
  .superRefine((environment, context) => {
    if (
      environment.FEATURE_AI_GENERATION === "true" &&
      !environment.OPENAI_API_KEY
    ) {
      addRequiredIssue(context, "OPENAI_API_KEY");
    }

    if (environment.NODE_ENV !== "production") {
      return;
    }

    for (const variable of [
      "APP_URL",
      "DATABASE_URL",
      "CONNECTOR_ENCRYPTION_KEY",
    ] as const) {
      if (!environment[variable]) {
        addRequiredIssue(context, variable);
      }
    }

    if (environment.APP_URL && !isSecurePublicUrl(environment.APP_URL)) {
      context.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "Production APP_URL must use HTTPS unless it is loopback.",
      });
    }

    if (
      environment.CONNECTOR_ENCRYPTION_KEY?.toLowerCase().includes("change-me")
    ) {
      context.addIssue({
        code: "custom",
        path: ["CONNECTOR_ENCRYPTION_KEY"],
        message: "Production connector encryption key must not be a placeholder.",
      });
    }

    if (
      environment.EMAIL_PROVIDER === "console" &&
      environment.ALLOW_CONSOLE_EMAIL_IN_PRODUCTION !== "true"
    ) {
      context.addIssue({
        code: "custom",
        path: ["ALLOW_CONSOLE_EMAIL_IN_PRODUCTION"],
        message: "Console email delivery requires explicit production opt-in.",
      });
    }

    if (environment.FEATURE_PUBLIC_DEMO === "true") {
      context.addIssue({
        code: "custom",
        path: ["FEATURE_PUBLIC_DEMO"],
        message: "Public demo cannot be enabled in production.",
      });
    }

    if (environment.COOKIE_SECURE === "false") {
      context.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "Production cookies must remain secure.",
      });
    }
  });

export type ValidatedEnvironment = z.infer<typeof environmentSchema>;

export class EnvironmentValidationError extends Error {
  readonly variables: string[];

  constructor(issues: ReadonlyArray<{ path: PropertyKey[] }>) {
    const variables = [
      ...new Set(
        issues.map((issue) => String(issue.path[0] ?? "environment")),
      ),
    ].sort();

    super(`Invalid environment configuration: ${variables.join(", ")}.`);
    this.name = "EnvironmentValidationError";
    this.variables = variables;
  }
}

export function validateEnvironment(
  input: EnvironmentInput = process.env,
): ValidatedEnvironment {
  const result = environmentSchema.safeParse(withoutEmptyValues(input));

  if (!result.success) {
    throw new EnvironmentValidationError(result.error.issues);
  }

  return result.data;
}

function withoutEmptyValues(input: EnvironmentInput) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== ""),
  );
}

function addRequiredIssue(
  context: z.RefinementCtx,
  variable: "APP_URL" | "DATABASE_URL" | "CONNECTOR_ENCRYPTION_KEY" | "OPENAI_API_KEY",
) {
  context.addIssue({
    code: "custom",
    path: [variable],
    message: `${variable} is required.`,
  });
}

function isSecurePublicUrl(value: string) {
  const url = new URL(value);
  return (
    url.protocol === "https:" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  );
}
