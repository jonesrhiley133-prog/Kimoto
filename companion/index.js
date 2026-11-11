#!/usr/bin/env node
/**
 * Kimoto Discord companion.
 *
 * Browsers can't reach Discord's local IPC socket, so the Kimoto web app sends presence updates to
 * this tiny local WebSocket server (127.0.0.1 only), which forwards them to the Discord desktop app.
 *
 *   DISCORD_CLIENT_ID=123... KIMOTO_ORIGINS=https://kimoto.example.com npm run companion
 */
import { WebSocketServer } from 'ws';
import { Client } from '@xhayper/discord-rpc';

const PORT = Number(process.env.KIMOTO_COMPANION_PORT ?? 47123);
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
// Only these web origins may control your presence (stops random websites from doing it).
const ORIGINS = new Set((process.env.KIMOTO_ORIGINS ?? 'http://localhost:5173,http://localhost:4000').split(',').map((s) => s.trim().replace(/\/$/, '')));

if (!CLIENT_ID) {
  console.error('Set DISCORD_CLIENT_ID to your Discord application id (https://discord.com/developers/applications).');
  process.exit(1);
}

let rpc = null;
let ready = false;
let last = null;

async function connectDiscord() {
  rpc = new Client({ clientId: CLIENT_ID });
  rpc.on('ready', () => {
    ready = true;
    console.log(`Connected to Discord as ${rpc.user?.username ?? 'user'}`);
    if (last) apply(last);
  });
  rpc.on('disconnected', () => {
    ready = false;
    console.log('Discord disconnected — retrying in 15s');
    setTimeout(connectDiscord, 15000);
  });
  try {
    await rpc.login();
  } catch (e) {
    ready = false;
    console.log(`Discord not available (${e.message}). Is the Discord app running? Retrying in 15s`);
    setTimeout(connectDiscord, 15000);
  }
}

function apply(msg) {
  if (!ready) return;
  if (msg.type === 'clear') return rpc.user?.clearActivity().catch(() => undefined);
  rpc.user?.setActivity({
    details: String(msg.details ?? 'Reading on Kimoto').slice(0, 128),
    state: String(msg.state ?? '').slice(0, 128) || undefined,
    startTimestamp: typeof msg.startTimestamp === 'number' ? msg.startTimestamp : undefined,
    largeImageKey: process.env.DISCORD_LARGE_IMAGE ?? 'kimoto',
    largeImageText: String(msg.largeImageText ?? 'Kimoto').slice(0, 128),
    instance: false,
  }).catch((e) => console.log('setActivity failed:', e.message));
}

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT, maxPayload: 4096 });
wss.on('connection', (ws, req) => {
  const origin = (req.headers.origin ?? '').replace(/\/$/, '');
  if (!ORIGINS.has(origin)) {
    console.log(`Rejected connection from origin "${origin}". Add it to KIMOTO_ORIGINS to allow it.`);
    return ws.close(1008, 'origin not allowed');
  }
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong', discord: ready }));
    if (msg.type === 'presence' || msg.type === 'clear') { last = msg; apply(msg); }
  });
  ws.on('close', () => { if (wss.clients.size === 0) { last = { type: 'clear' }; apply(last); } });
});

console.log(`Kimoto companion listening on ws://127.0.0.1:${PORT} (allowed origins: ${[...ORIGINS].join(', ')})`);
connectDiscord();
