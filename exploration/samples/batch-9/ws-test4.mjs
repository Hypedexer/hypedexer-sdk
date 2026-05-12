import WebSocket from '/tmp/node_modules/ws/wrapper.mjs';
import fs from 'node:fs';

const API = 'REDACTED_API_KEY';
const URL = 'wss://api.hypedexer.com/ws';
const out = fs.createWriteStream('/home/yaugourt/hypedexer-sdk/exploration/samples/batch-9/ws-session.jsonl', { flags: 'a' });
const log = (dir, msg, extra={}) => out.write(JSON.stringify({ dir, ts: Date.now(), ...extra, msg }) + '\n');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('waiting 20s for rate limit reset...');
await sleep(20000);

// Also try bearer once more before main session
console.log('testing bearer again...');
await new Promise((resolve) => {
  const ws = new WebSocket(URL, { headers: { Authorization: `Bearer ${API}` } });
  const t = setTimeout(() => { try { ws.terminate(); } catch {} resolve(); }, 4000);
  ws.on('open', () => { log('open', null, { label: 'bearer-retry' }); console.log('BEARER OPENED'); ws.close(); });
  ws.on('message', (data) => { let d; try { d = JSON.parse(data.toString()); } catch { d = data.toString(); } log('<-', d, { label: 'bearer-retry' }); });
  ws.on('unexpected-response', (req, res) => { log('error', `unexpected ${res.statusCode}`, { label: 'bearer-retry' }); console.log('BEARER got', res.statusCode); });
  ws.on('error', (e) => log('error', e.message, { label: 'bearer-retry' }));
  ws.on('close', (code, reason) => { log('close', { code, reason: reason.toString() }, { label: 'bearer-retry' }); clearTimeout(t); resolve(); });
});
await sleep(3000);

console.log('main session starting...');
const ws = new WebSocket(URL, { headers: { 'X-API-Key': API } });
await new Promise((resolve, reject) => {
  ws.on('open', () => { log('open', null, { label: 'main' }); resolve(); });
  ws.on('error', (e) => { log('error', e.message, { label: 'main' }); });
  ws.on('unexpected-response', (req, res) => { log('error', `unexpected ${res.statusCode}`, { label: 'main' }); reject(new Error('upgrade '+res.statusCode)); });
  setTimeout(() => reject(new Error('open timeout')), 8000);
});

ws.on('message', (data) => { let s = data.toString(); let d; try { d = JSON.parse(s); } catch { d = s; } log('<-', d, { label: 'main' }); });
ws.on('close', (code, reason) => log('close', { code, reason: reason.toString() }, { label: 'main' }));
ws.on('ping', (data) => log('ping', data.toString('hex'), { label: 'main' }));
ws.on('pong', (data) => log('pong', data.toString('hex'), { label: 'main' }));

const send = (obj) => { log('->', obj, { label: 'main' }); ws.send(JSON.stringify(obj)); };

await sleep(800);
send({ method: 'list_subscriptions' });
await sleep(800);
send({ method: 'subscribe', subscription: { type: 'completed_trades' } });
await sleep(20000);
send({ method: 'list_subscriptions' });
await sleep(800);
send({ method: 'subscribe', subscription: { type: 'completed_trades', user: '0xf3f496c9486be5924a93d67e98298733bb47057c' } });
await sleep(12000);
send({ method: 'unsubscribe', subscription: { type: 'completed_trades' } });
await sleep(1200);
send({ method: 'list_subscriptions' });
await sleep(800);
send({ method: 'subscribe', subscription: { type: 'not_a_real_channel' } });
await sleep(1200);
send({ method: 'subscribe', subscription: { type: 'liquidation' } });
await sleep(1500);
send({ method: 'subscribe', subscription: { type: 'fills_spot' } });
await sleep(1500);
send({ method: 'subscribe', subscription: { type: 'recent_activity' } });
await sleep(1500);
send({ method: 'subscribe', subscription: { type: 'hip4_events' } });
await sleep(1500);
send({ method: 'list_subscriptions' });
await sleep(1000);
send({ method: 'bogus_method' });
await sleep(1000);
send('not-json-at-all');
await sleep(1000);

ws.close(1000, 'done');
await sleep(800);
out.end();
console.log('done');
