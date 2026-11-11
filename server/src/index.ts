import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';
import { startScheduler } from './services/scheduler.js';
import { ensureSampleLibrary } from './sample.js';

ensureSampleLibrary();
const app = createApp();
const server = http.createServer(app);
attachRealtime(server, [config.publicUrl, ...config.appOrigins]);
startScheduler();

server.listen(config.port, () => {
  console.log(`Kimoto API listening on http://localhost:${config.port}`);
  console.log(`Database: ${config.dbPath}`);
  console.log(`Local library: ${config.libraryDir}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
