import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { CodexAppServerClient, codexAppServerArgs, codexThreadConfigOverrides } from '../electron/codexAppServerClient.js';
import { normalizeCodexOptions } from '../shared/codexOptions.js';

function client(extra = {}) {
  return new CodexAppServerClient({ appVersion: () => 'test', defaultCwd: () => '/tmp', resolveCodexCommand: async () => ({command:'codex'}), localizedInstructions: () => '', logDebug: () => {}, loadedThreads: new Set(), requestTimeoutMs: 100, ...extra });
}
function processFixture() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  return child;
}

test('preserves configured integrations unless isolation explicitly requested', () => {
  const previous = process.env.CODEX_MESSENGER_DISABLE_CODEX_CONNECTORS;
  try {
    delete process.env.CODEX_MESSENGER_DISABLE_CODEX_CONNECTORS;
    assert.deepEqual(codexAppServerArgs(), ['app-server']);
    assert.equal(codexThreadConfigOverrides(), null);
    process.env.CODEX_MESSENGER_DISABLE_CODEX_CONNECTORS = '1';
    assert.ok(codexAppServerArgs().includes('mcp_servers={}'));
    assert.deepEqual(codexThreadConfigOverrides().mcp_servers, {});
  } finally { if (previous === undefined) delete process.env.CODEX_MESSENGER_DISABLE_CODEX_CONNECTORS; else process.env.CODEX_MESSENGER_DISABLE_CODEX_CONNECTORS = previous; }
});
test('UTF8 split across chunks preserves accents and emoji', () => {
  const c = client(); const messages=[]; c.on('notification', m=>messages.push(m));
  const data=Buffer.from(JSON.stringify({method:'item/agentMessage/delta',params:{delta:'été 🙂 日本語'}})+'\n');
  for(const byte of data) c.readStdout(Buffer.from([byte]));
  assert.equal(messages[0].params.delta,'été 🙂 日本語');
});
test('RPC response arriving synchronously during write is resolved', async () => {
  const c=client(); c.child=processFixture();
  c.child.stdin.write=(line,callback)=>{ const m=JSON.parse(line); c.handleMessage({id:m.id,result:{ok:true}}); callback?.(); return true; };
  assert.deepEqual(await c.request('test'),{ok:true}); assert.equal(c.pending.size,0); c.dispose();
});
test('failed command resolution can be retried', async () => {
  let attempts=0;const child=processFixture();
  child.stdin.on('data',line=>{const m=JSON.parse(line);if(m.id)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:m.id,result:{userAgent:'test'}})+'\n'));});
  const c=client({resolveCodexCommand:async()=>{if(++attempts===1)throw new Error('missing');return {command:'test'};},spawnProcess:()=>child});
  await assert.rejects(c.ensureReady(),/missing/);await c.ensureReady();assert.equal(attempts,2);c.dispose();
});
test('stale process exit cannot clear a replacement connection', async () => {
  const children=[];const c=client({spawnProcess:()=>{const child=processFixture();children.push(child); child.stdin.on('data',line=>{const m=JSON.parse(line);if(m.id)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:m.id,result:{userAgent:'test'}})+'\n'));}); return child;}});
  await c.ensureReady();c.stop();await c.ensureReady();children[0].emit('exit',1);assert.equal(c.child,children[1]);assert.equal(c.userAgent,'test');c.dispose();
});
test('write errors reject immediately and retain RPC error metadata', async () => {
  const c=client();c.child=processFixture();c.child.stdin.write=()=>{throw new Error('closed pipe');};
  await assert.rejects(c.request('test'),/closed pipe/);assert.equal(c.pending.size,0);
  c.child.stdin.write=(line)=>{const m=JSON.parse(line);c.handleMessage({id:m.id,error:{code:-32601,message:'unsupported',data:{method:m.method}}});};
  await assert.rejects(c.request('unknown'),error=>error.code===-32601&&error.data.method==='unknown');c.dispose();
});
test('modern modes, named permissions, tiers and dynamic efforts survive saved settings', () => {
  const value=normalizeCodexOptions({reasoningEffort:'ultra',approvalPolicy:'on-failure',permissions:'workspace-safe',serviceTier:'fast',collaborationMode:{mode:'plan',settings:{model:'from-model-list',developer_instructions:'invented'}}});
  assert.equal(value.reasoningEffort,'ultra');assert.equal(value.approvalPolicy,'on-request');assert.equal(value.permissions,'workspace-safe');assert.equal(value.serviceTier,'fast');assert.equal(value.collaborationMode.settings.developer_instructions,null);
});
test('history requests full items and permissions are exclusive with sandbox', async () => {
  const c=client();const requests=[];c.ensureReady=async()=>{};c.request=async(method,params)=>{requests.push({method,params});return {turn:{id:'turn'}};};
  await c.listThreadTurns('thread');assert.equal(requests.at(-1).params.itemsView,'full');
  await c.startTurn('thread','hello',{permissions:'profile',reasoningEffort:'ultra'});
  assert.equal(requests.at(-1).params.permissions,'profile');assert.equal('sandboxPolicy' in requests.at(-1).params,false);assert.equal(requests.at(-1).params.effort,'ultra');
});
