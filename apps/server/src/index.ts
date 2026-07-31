import { createServerApp } from "./app";
import { loadServerConfig } from "./config";
import { createDatabase } from "./database/client";
import { ModelPricingRepository } from "./repositories/model-pricing-repository";
import { ModelPricingSyncService } from "./services/model-pricing-sync-service";

const config = loadServerConfig();
const database = createDatabase(config.databasePath);
const modelPricing = new ModelPricingRepository(database);
const modelPricingSync = new ModelPricingSyncService(modelPricing, config);
const app = createServerApp({ config, database, modelPricingSync });

modelPricingSync.start();

app.listen({ hostname: config.host, port: config.port });

console.log(`[maple-server] listening on http://${config.host}:${config.port}`);
console.log(`[maple-server] dashboard: http://${config.host}:${config.port}/`);
console.log(`[maple-server] database: ${config.databasePath}`);
console.log(`[maple-server] web assets: ${config.webRoot}`);

function shutdown() {
  modelPricingSync.stop();
  app.stop();
  database.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
