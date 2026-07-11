import { rm } from "node:fs/promises";
import path from "node:path";

const dataDir =
  process.env.PGLITE_DATA_DIR ??
  path.join(process.cwd(), ".data", "tradikom-one-pglite");

async function main() {
  await rm(dataDir, { recursive: true, force: true });
  console.log(`Database reset: ${dataDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
