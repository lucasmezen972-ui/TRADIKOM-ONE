"use client";

import { useSyncExternalStore } from "react";

const subscribeToHydration = () => () => undefined;

export function HydrationMarker() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  return (
    <span
      hidden
      aria-hidden="true"
      data-app-hydrated={hydrated ? "true" : "false"}
    />
  );
}
