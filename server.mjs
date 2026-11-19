// ===== سيرفر واحد يشغّل الموقع كله برّه Vercel =====
// نفس الكود بالظبط: واجهة الموقع (dist بعد npm run build) + كل نقاط api/* + المُشغّل
// الدوري (سحب الأرقام والإشعارات). يشتغل على أي استضافة Node: Railway / Render /
// Coolify / سيرفر خاص — من غير ما نربط السيستم بخدمة واحدة تقدر تقفله.
//
// التشغيل:   npm run build && npm start      (PORT من متغيّرات البيئة، وإلا 3000)
// المتغيّرات: نفس اللي على Vercel — AUTH_SECRET + قاعدة البيانات (D1_* أو SUPABASE_*)
//            + CRON_SECRET (لتشغيل السحب الدوري من جوه السيرفر نفسه).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, 'dist');
const PORT = Number(process.env.PORT) || 3000;

// ===== نقاط الـ API (نفس توزيع Vercel للملفات) =====
const ROUTES = [
  { match: (p) => p === '/api/store', file: 'api/store.js' },
  { match: (p) => p === '/api/auth' || p.startsWith('/api/auth/'), file: 'api/auth.js' },
  { match: (p) => p === '/api/cron', file: 'api/cron.js' },
  { match: (p) => p === '/api/lead-source' || p.startsWith('/api/lead-source/'), file: 'api/lead-source.js' },
  { match: (p) => p === '/api/admin/migrate', file: 'api/admin/migrate.js' },
  { match: (p) => p === '/api/public-page', file: 'api/public-page.js' },
  { match: (p) => p.startsWith('/api/public/'), file: 'api/public/[...path].js' },
  { match: (p) => p.startsWith('/api/push/'), file: 'api/push/[...path].js' },
  // vercel.json rewrites: صفحة الوحدة العامة
  { match: (p) => p === '/p' || p.startsWith('/p/'), file: 'api/public-page.js' },
];

const handlers = new Map();
const handlerFor = async (file) => {
  if (!handlers.has(file)) {
    const mod = await import(pathToFileURL(path.join(root, file)).href);
    handlers.set(file, mod.default);
  }
  return handlers.get(file);
};

// ===== الملفات الثابتة (الواجهة) =====
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
};
// نفس هيدرز vercel.json: الصفحة والـ service worker دايماً أحدث نسخة، والـ assets بالبصمة للأبد
const cacheFor = (urlPath) => {
  if (urlPath === '/' || urlPath === '/index.html' || urlPath === '/sw.js') return 'no-cache, no-store, must-revalidate';
  if (urlPath === '/manifest.webmanifest') return 'no-cache, must-revalidate';
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
};

const sendFile = (req, res, filePath, urlPath) => {
  const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cacheFor(urlPath));
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
};

const serveStatic = (req, res, urlPath) => {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    /* مسار غير صالح — يروح للصفحة الرئيسية */
  }
  // ممنوع الخروج برّه dist
  const target = path.normalize(path.join(distDir, decoded));
  if (target.startsWith(distDir) && fs.existsSync(target) && fs.statSync(target).isFile()) {
    return sendFile(req, res, target, urlPath);
  }
  // تطبيق صفحة واحدة: أي مسار تاني = الصفحة الرئيسية
  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('الواجهة مش مبنية — شغّل npm run build الأول');
  }
  return sendFile(req, res, index, '/index.html');
};

export const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0] || '/';
  try {
    const route = ROUTES.find((r) => r.match(urlPath));
    if (route) {
      const handler = await handlerFor(route.file);
      return await handler(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      return res.end();
    }
    return serveStatic(req, res, urlPath);
  } catch (error) {
    console.error('[server]', urlPath, error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify({ error: 'server error' }));
  }
});

// ===== المُشغّل الدوري من جوه السيرفر =====
// على Vercel كانت خدمة خارجية بتنادي /api/cron كل ٥ دقايق. هنا السيرفر شغّال دايماً،
// فبينادي نفسه كل دقيقة (المعالج نفسه بيحترم «كل كم دقيقة يسحب» من الإعدادات).
const CRON_EVERY_MS = 60 * 1000;
const runCron = async () => {
  const secret = String(process.env.CRON_SECRET || '');
  if (!secret) return;
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/cron`, { headers: { authorization: `Bearer ${secret}` } });
  } catch (error) {
    console.error('[cron]', String(error?.message || error));
  }
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, () => {
    console.log(`CRM شغّال على المنفذ ${PORT}`);
    if (process.env.CRON_SECRET) {
      setTimeout(runCron, 15 * 1000);
      setInterval(runCron, CRON_EVERY_MS);
    } else {
      console.log('CRON_SECRET مش مضبوط — السحب التلقائي من فيسبوك والإشعارات الدورية مش هيشتغلوا');
    }
  });
}
