import { createServerApp } from "./app";
import { loadServerConfig } from "./config";
import { createDatabase } from "./database/client";

const config = loadServerConfig();
const database = createDatabase(config.databasePath);
const app = createServerApp({ config, database });

app.listen({ hostname: config.host, port: config.port });

console.log(`[maple-server] listening on http://${config.host}:${config.port}`);
console.log(`[maple-server] dashboard: http://${config.host}:${config.port}/`);
console.log(`[maple-server] database: ${config.databasePath}`);
console.log(`[maple-server] web assets: ${config.webRoot}`);

function shutdown() {
  app.stop();
  database.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
