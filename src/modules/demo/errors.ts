export type DemoErrorCode = "demo_disabled" | "demo_tenant_unavailable";

export class DemoError extends Error {
  constructor(
    public readonly code: DemoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DemoError";
  }
}
