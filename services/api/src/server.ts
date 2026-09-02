// Must run before app.js, which reads configuration at import time.
import {loadEnv} from './env.js';
const envFiles = loadEnv();

const {app} = await import('./app.js');
const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`TerraMavuno API: http://localhost:${port}`);
  console.log(envFiles.length ? `env: ${envFiles.join(', ')}` : 'env: none found (using process environment only)');
  console.log(`health: http://localhost:${port}/health`);
});
