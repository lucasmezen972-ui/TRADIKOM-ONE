import { closeDb } from "@/lib/db";
import { validateEnvironment } from "@/lib/environment";
import {
  runWorkerFromEnvironment,
  writeStructuredWorkerLog,
} from "@/worker/runtime";

async function main() {
  validateEnvironment(process.env);
  const shutdown = new AbortController();

  for (const signal of ["SIGTERM", "SIGINT"] satisfies NodeJS.Signals[]) {
    process.once(signal, () => {
      writeStructuredWorkerLog({
        level: "info",
        event: "worker.signal",
        message: `Worker received ${signal}; shutdown requested.`,
        correlationId: "worker-process",
        signal,
      });
      shutdown.abort(signal);
    });
  }

  await runWorkerFromEnvironment(process.env, { signal: shutdown.signal });
}

main()
  .catch((error) => {
    writeStructuredWorkerLog({
      level: "error",
      event: "worker.error",
      message: error instanceof Error ? error.message : "Worker failed.",
      correlationId: "worker-process",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
