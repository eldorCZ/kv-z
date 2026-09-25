import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startRetention } from './retention.js';

const cfg = loadConfig();
const { app, services } = await buildApp(cfg);
const stopRetention = startRetention(services, app.log);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  stopRetention();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: cfg.bindAddr, port: cfg.port });
