import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {startDiscoveryResponder,discoverLanHosts} from '../desktop/lan-discovery.mjs';
import {remoteHostEndpoint,identifyHost} from '../src/coop/host-connection.mjs';
const hostId='12345678-1234-1234-1234-123456789abc';
const bind=socket=>new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,'127.0.0.1',()=>resolve(socket.address().port));});

test('LAN UDP discovery locates custom TCP port and stops advertising after shutdown',async()=>{
  const probe=dgram.createSocket('udp4'),port=await bind(probe);probe.close();
  const responder=await startDiscoveryResponder({hostId,port:23456,discoveryPort:port});
  try{
    const found=await discoverLanHosts({duration:120,discoveryPort:port,targets:['127.0.0.1']});
    assert.deepEqual(found,[{hostId,endpoint:'http://127.0.0.1:23456'}]);
  }finally{responder.close();}
  assert.deepEqual(await discoverLanHosts({duration:40,discoveryPort:port,targets:['127.0.0.1']}),[]);
});

test('discovery rejects unrelated, oversized, mismatched and invalid replies and ignores advertised URLs',async()=>{
  const peer=dgram.createSocket('udp4'),port=await bind(peer);
  peer.on('message',(bytes,source)=>{
    const query=JSON.parse(bytes);
    const good={format:query.format,version:1,kind:'host',nonce:query.nonce,hostId,port:23456};
    for(const reply of [{...good,nonce:'0'.repeat(32)},{...good,hostId:'invalid'},{...good,port:80},
      {...good,format:'another-game'},{...good,padding:'x'.repeat(1000)},
      {...good,endpoint:'http://evil.example/path'}]){
      peer.send(JSON.stringify(reply),source.port,source.address);
    }
  });
  try{assert.deepEqual(await discoverLanHosts({duration:100,discoveryPort:port,targets:['127.0.0.1']}),
    [{hostId,endpoint:'http://127.0.0.1:23456'}]);}finally{peer.close();}
});

test('remote entry accepts plain IP/domain and custom port while rejecting credentials and paths',async()=>{
  assert.equal(remoteHostEndpoint('172.16.2.5'),'http://172.16.2.5:18735');
  assert.equal(remoteHostEndpoint(' example.com:23456 '),'http://example.com:23456');
  assert.equal(remoteHostEndpoint('https://example.com'),'https://example.com');
  for(const raw of ['', 'ws://example.com','example.com/path','user:password@example.com','example.com/?token=x'])assert.throws(()=>remoteHostEndpoint(raw));
  await assert.rejects(identifyHost('http://127.0.0.1:23456',{base:'http://localhost/',expectedHostId:hostId,
    fetcher:async()=>({ok:true,json:async()=>({format:'pokerogue-local-host',version:1,hostId:'aaaaaaaa-1234-1234-1234-123456789abc'})})}),/HOST_ID_CHANGED/);
});
