import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { attachCoopServer } from './server/coop-service.mjs';
import { attachFormalCoopServer, FormalRoomStore } from './server/formal-coop-service.mjs';
import { createOriginalCoopAdapter } from './server/original-coop-adapter.mjs';
import {loadHostIdentity,serveHostIdentity} from './server/host-identity.mjs';
// import fs from 'vite-plugin-fs';

export default defineConfig(({ mode }) => {
	let coopService;
	let formalCoopService;
	let profileAdapter;
	let closing;
	const closeServices = () => closing ??= (async () => {
		await formalCoopService?.close();
		await coopService?.close();
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
				coopService = await attachCoopServer(server.httpServer, { directory: process.env.COOP_DATA ?? 'server/data/rooms' });
				profileAdapter = process.env.COOP_PROFILE_LOBBY === '1'
					? createOriginalCoopAdapter({ fixture: { profileLobby: true,
						identities: [{ trainerId: 0, secretId: 0 }, { trainerId: 0, secretId: 0 }] },
						seedFactory: () => randomUUID() })
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
			rollupOptions: { input: { game: resolve('index.html'), saves: resolve('save-tools.html'), coop: resolve('coop.html'), coopPlay: resolve('coop-play.html') } },
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
