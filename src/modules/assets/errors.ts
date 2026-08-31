export type AssetErrorCode =
  | "asset_access_denied"
  | "asset_empty"
  | "asset_too_large"
  | "asset_type_not_allowed"
  | "asset_not_found"
  | "asset_in_use"
  | "asset_storage_unavailable";

export class AssetError extends Error {
  constructor(
    readonly code: AssetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AssetError";
  }
}
