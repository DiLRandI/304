import { buildApp, loadConfig } from "./app.js";

const config = loadConfig();
const app = await buildApp({
  config,
  readiness: {
    database: async () => false,
    redis: async () => false,
  },
});

await app.listen({ host: config.HOST, port: config.PORT });
