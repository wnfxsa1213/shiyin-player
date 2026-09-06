// Produces an isolated native stress-test binary; application sources/config are not edited.
import { build } from '../../apps/rustplayer-tauri/frontend/node_modules/esbuild/lib/main.js';
import { mkdir, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = path.join(root, 'apps/rustplayer-tauri/frontend');
const output = path.resolve(root, process.argv[2] || 'work/scene-stress');
const dist = path.join(output, 'dist');
await mkdir(dist, { recursive: true });
const run = (cmd, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', ...options });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
});
await run('npm', ['run', 'build'], { cwd: frontend });
await build({
  absWorkingDir: frontend,
  stdin: { contents: await readFile(path.join(root, 'scripts/scene-stress/harness.js'), 'utf8'), resolveDir: frontend, sourcefile: 'scene-stress.js' },
  bundle: true, minify: true, format: 'esm', outfile: path.join(dist, 'app.js'),
  tsconfig: path.join(frontend, 'tsconfig.json'), loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true}' },
});
const styles = (await readdir(path.join(frontend, 'dist/assets'))).filter(name => name.endsWith('.css'));
await writeFile(path.join(dist, 'style.css'), (await Promise.all(styles.map(name => readFile(path.join(frontend, 'dist/assets', name), 'utf8')))).join('\n'));
await writeFile(path.join(dist, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><title>拾音 · 压力测试</title></head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>');
await run('/usr/bin/python3', [path.join(root, 'scripts/scene-stress/fixtures.py'), dist]);
const applicationConfig = JSON.parse(await readFile(path.join(root, 'apps/rustplayer-tauri/src-tauri/tauri.conf.json'), 'utf8'));
const config = {
  build: { frontendDist: dist },
  app: {
    windows: [{ label: 'main', title: '拾音 · 场景压力测试', width: 1200, height: 800, minWidth: 900, minHeight: 600, x: 20, y: 60, resizable: true, decorations: true }],
    security: { csp: applicationConfig.app.security.csp.replace('connect-src ', "connect-src 'self' "), capabilities: ['default', { identifier: 'scene-stress-window', windows: ['main'], permissions: ['core:window:allow-set-size', 'core:window:allow-set-position', 'core:window:allow-set-focus', 'core:window:allow-hide', 'core:window:allow-show', 'core:window:allow-minimize', 'core:window:allow-unminimize'] }] },
  },
};
await writeFile(path.join(output, 'tauri-config.json'), JSON.stringify(config, null, 2));
await run('cargo', ['build', '--release', '-p', 'rustplayer-tauri', '--locked', '--offline', '--features', 'tauri/custom-protocol', '--jobs', '6'], { env: { ...process.env, TAURI_CONFIG: JSON.stringify(config) } });
await copyFile(path.join(root, 'target/release/rustplayer-tauri'), path.join(output, 'scene-stress'));
// Restore the ordinary release artifact; the instrumented binary lives only under output.
const normalEnv = { ...process.env };
delete normalEnv.TAURI_CONFIG;
await run('cargo', ['build', '--release', '-p', 'rustplayer-tauri', '--locked', '--offline', '--features', 'tauri/custom-protocol', '--jobs', '6'], { env: normalEnv });
console.log(`Stress binary: ${path.join(output, 'scene-stress')}`);
