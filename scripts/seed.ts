import { getServices } from "../src/lib/services";
import { closeDb } from "../src/lib/db";

async function main() {
  const services = await getServices();
  const demo = await services.seedDemo();

  console.log("Demo seed ready.");
  console.log(`Email: ${demo.user.email}`);
  console.log(`Password: ${demo.password}`);
  console.log(`Tenant: ${demo.tenant.name}`);
  console.log(`Site: /sites/${demo.tenant.slug}`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
