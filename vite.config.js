import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// import fs from 'vite-plugin-fs';

export default defineConfig(({ mode }) => {
	return {
		plugins: [/*fs()*/],
		server: { host: '0.0.0.0', port: 8020, strictPort: true },
		clearScreen: false,
		build: {
			rollupOptions: { input: { game: resolve('index.html'), saves: resolve('save-tools.html') } },
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
