// Local compilation only. This does not create a project, upload files or deploy.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(new URL('../dist/index.html', import.meta.url))) throw new Error('Run npm run build first');
execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
  'pages', 'functions', 'build', 'functions', '--outdir', 'dist/_worker.js',
  '--output-routes-path', 'dist/_routes.json', '--compatibility-date', '2026-11-06'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
});
