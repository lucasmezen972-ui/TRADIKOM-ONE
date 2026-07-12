type DemoEnvironment = Record<string, string | undefined>;

export function isPublicDemoEnabled(
  environment: DemoEnvironment = process.env,
) {
  return (
    environment.NODE_ENV !== "production" &&
    environment.FEATURE_PUBLIC_DEMO === "true"
  );
}

export function isDemoSeedEnabled(
  environment: DemoEnvironment = process.env,
) {
  return environment.NODE_ENV === "test" || isPublicDemoEnabled(environment);
}
