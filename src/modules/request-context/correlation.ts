import { randomUUID } from "node:crypto";

const correlationIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

export function resolveCorrelationId(value?: string | null) {
  const candidate = value?.trim();
  return candidate && correlationIdPattern.test(candidate)
    ? candidate
    : randomUUID();
}
