import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { attachCoopServer } from './server/coop-service.mjs';
import { attachFormalCoopServer } from './server/formal-coop-service.mjs';
// import fs from 'vite-plugin-fs';

export default defineConfig(({ mode }) => {
	let coopService;
	let formalCoopService;
	return {
		plugins: [{
			name: 'early-coop-server',
			async configureServer(server) { coopService = await attachCoopServer(server.httpServer); formalCoopService = await attachFormalCoopServer(server.httpServer); },
			async closeBundle() { await formalCoopService?.close(); await coopService?.close(); }
		}],
		server: { host: '0.0.0.0', port: 8020, strictPort: true },
		clearScreen: false,
		build: {
			rollupOptions: { input: { game: resolve('index.html'), saves: resolve('save-tools.html'), coop: resolve('coop.html') } },
			minify: 'esbuild',
			sourcemap: false,
			reportCompressedSize: false
		},
		esbuild: {
			pure: mode === 'production' ? [ 'console.log' ] : [],
			keepNames: true,
		},
	}
})
