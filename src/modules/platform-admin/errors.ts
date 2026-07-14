export class PlatformAdminError extends Error {
  constructor(
    public readonly code: "platform_admin_required" | "platform_role_invalid",
    message: string,
  ) {
    super(message);
    this.name = "PlatformAdminError";
  }
}
