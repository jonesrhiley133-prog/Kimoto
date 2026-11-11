import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { errorHandler, notFound } from './lib/http.js';
import { loadUser, csrfGuard } from './lib/auth.js';
import { auth } from './routes/auth.js';
import { titles } from './routes/titles.js';
import { library } from './routes/library.js';
import { reading } from './routes/reading.js';
import { lists } from './routes/lists.js';
import { users } from './routes/users.js';
import { community, mod } from './routes/community.js';
import { messages, emoji } from './routes/messages.js';
import { settings, notifications } from './routes/settings.js';
import { stats, rankings } from './routes/stats.js';
import { integrations } from './routes/integrations.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  // CORS for the native apps only (they call the API from their own local origin with bearer tokens).
  const appOrigins = new Set(config.appOrigins);
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && appOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-kimoto, x-kimoto-client');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: 'text/plain', limit: '64kb' })); // navigator.sendBeacon payloads
  app.use(loadUser);
  app.use(csrfGuard);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', auth);
  app.use('/api', titles);
  app.use('/api/library', library);
  app.use('/api/reading', reading);
  app.use('/api/lists', lists);
  app.use('/api', users);
  app.use('/api', community);
  app.use('/api/mod', mod);
  app.use('/api/messages', messages);
  app.use('/api/emoji', emoji);
  app.use('/api/settings', settings);
  app.use('/api/notifications', notifications);
  app.use('/api/stats', stats);
  app.use('/api/rankings', rankings);
  app.use('/api/integrations', integrations);
  app.use('/api', (_req, _res, next) => next(notFound('No such endpoint')));

  app.use('/uploads', express.static(config.uploadsDir, {
    maxAge: '30d', immutable: true,
    setHeaders: (res) => res.setHeader('Content-Security-Policy', "default-src 'none'"),
  }));

  // Serve the built web app in production (SPA fallback).
  if (fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { maxAge: '1h', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }
  app.use(errorHandler);
  return app;
}
