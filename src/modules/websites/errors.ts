export type WebsiteErrorCode =
  | "website_not_found"
  | "section_not_found"
  | "version_not_found"
  | "published_site_not_found";

export class WebsiteError extends Error {
  constructor(
    public readonly code: WebsiteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WebsiteError";
  }
}
