type DemoEnvironment = Record<string, string | undefined>;

export function isPublicDemoEnabled(
  environment: DemoEnvironment = process.env,
) {
  if (environment.FEATURE_PUBLIC_DEMO !== "true") {
    return false;
  }

  if (environment.NODE_ENV !== "production") {
    return true;
  }

  if (
    environment.CI !== "true" ||
    environment.E2E_ALLOW_PUBLIC_DEMO !== "true" ||
    !environment.APP_URL
  ) {
    return false;
  }

  const hostname = new URL(environment.APP_URL).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isDemoSeedEnabled(
  environment: DemoEnvironment = process.env,
) {
  return environment.NODE_ENV === "test" || isPublicDemoEnabled(environment);
}
