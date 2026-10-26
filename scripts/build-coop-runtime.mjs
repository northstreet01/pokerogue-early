import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isBuiltin } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
// Separate from the browser build: never replace Phaser for / or /coop.html.
export async function buildCoopRuntime({ outDir = resolve(root, 'build/coop-runtime') } = {}) {
  return build({
    configFile: false, root, publicDir: false, logLevel: 'warn',
    resolve: { alias: [
      { find: /^phaser$/, replacement: resolve(root, 'server/headless-presentation.mjs') },
      { find: /^phaser3-rex-plugins\/.*$/, replacement: resolve(root, 'server/headless-rex.mjs') }
    ] },
    ssr: { noExternal: true },
    esbuild: { keepNames: true },
    build: {
      ssr: resolve(root, 'src/server/original-runtime.ts'),
      outDir, emptyOutDir: true,
      minify: false, sourcemap: false,
      rollupOptions: {
        external: isBuiltin,
        output: { format: 'cjs', entryFileNames: 'original-runtime.cjs' },
        plugins: [{ name: 'no-test-rule-dependencies', generateBundle(_options, bundle) {
          for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') {
            for (const path of Object.keys(chunk.modules)) {
              if (/[\\/](tests|test)[\\/]/.test(path)) throw new Error('TEST_DEPENDENCY_IN_RULE_RUNTIME');
            }
          }
        } }]
      }
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildCoopRuntime();
