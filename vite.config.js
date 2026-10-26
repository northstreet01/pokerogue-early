import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { attachFormalCoopServer, FormalRoomStore } from './server/formal-coop-service.mjs';
import { createPlayerHostAdapter } from './server/original-coop-adapter.mjs';
import {loadHostIdentity,serveHostIdentity} from './server/host-identity.mjs';

export default defineConfig(({ mode }) => {
	let formalCoopService;
	let profileAdapter;
	let closing;
	const closeServices = () => closing ??= (async () => {
		await formalCoopService?.close();
		await profileAdapter?.closeAll();
	})();
	return {
		plugins: [{
			name: 'early-coop-server',
			async configureServer(server) {
				const formalDirectory=process.env.COOP_FORMAL_DATA ?? 'server/data/formal-rooms';
				const identity=await loadHostIdentity(formalDirectory);
				const allowedOrigins=(process.env.COOP_CLIENT_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean);
				server.middlewares.use((request,response,next)=>{if(!serveHostIdentity(request,response,identity,allowedOrigins))next();});
				profileAdapter = process.env.COOP_PROFILE_LOBBY === '1'
					? createPlayerHostAdapter({ seedFactory: () => randomUUID() })
					: null;
				formalCoopService = await attachFormalCoopServer(server.httpServer, { adapter: profileAdapter,
					store: new FormalRoomStore(formalDirectory),allowedOrigins });
				server.httpServer.once('close', () => { void closeServices(); });
			},
			async closeBundle() { await closeServices(); }
		}],
		server: { host: process.env.COOP_BIND??'127.0.0.1', port: 8020, strictPort: true },
		clearScreen: false,
		build: {
			rollupOptions: { input: { game: resolve('index.html'), coopPlay: resolve('coop-play.html') } },
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
