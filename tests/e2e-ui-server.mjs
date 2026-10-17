// ===== سيرفر اختبار الواجهة على HTTP =====
// يقدّم **البناء الفعلي** (dist) مع نفس معالجات السيرفر الحقيقية (الدخول + البيانات
// + سحب الأرقام) على منفذ HTTP عادي، لأن سيرفر التطوير يعمل بـ HTTPS بشهادة موقّعة
// ذاتياً والمتصفح لا يقبلها تلقائياً. وبهذا نجرّب المسار الكامل كما يراه المستخدم:
//   شاشة دخول ← تسجيل دخول ← إلزام تغيير كلمة المرور الضعيفة ← فتح البيانات.
//
// التشغيل:
//   npm run build
//   node tests/e2e-ui-server.mjs        (المنفذ 4123 افتراضياً، ويُغيَّر بـ CRM_E2E_PORT)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CRM_E2E_PORT) || 4123;

// مفتاح الجلسة: من البيئة أو من ملف .env (نفس ما يستخدمه السيرفر المحلي)
const envFile = (() => {
  try {
    const raw = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return out;
  } catch {
    return {};
  }
})();
const env = { ...process.env, ...envFile };
if (!env.AUTH_SECRET) {
  console.error('AUTH_SECRET غير مضبوط — أضفه إلى .env أو البيئة أولاً.');
  process.exit(1);
}

const DB_FILE = path.resolve(env.CRM_DB_FILE || path.join(root, 'data', 'e2e-auth-db.json'));
const SOURCE_FILE = path.resolve(env.CRM_SOURCE_FILE || path.join(root, 'data', 'e2e-auth-source.json'));

const { fileStorage, createStoreHandler } = await import('../server/store.js');
const { createAuthHandler } = await import('../server/authApi.js');
const { createLeadSourceHandler } = await import('../server/leadSource.js');

const authHandler = createAuthHandler({ storage: fileStorage(DB_FILE), env });
const storeHandler = createStoreHandler({ ...fileStorage(DB_FILE), auth: env });
const leadHandler = createLeadSourceHandler({ storeFile: DB_FILE, configFile: SOURCE_FILE, auth: env });

const DIST = path.join(root, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const serveStatic = (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // تطبيق صفحة واحدة
  }
  const body = fs.readFileSync(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
};

const server = http.createServer((req, res) => {
  const pathname = (req.url || '').split('?')[0];
  if (pathname.startsWith('/api/auth')) return authHandler(req, res);
  if (pathname.startsWith('/api/store')) return storeHandler(req, res);
  if (pathname.startsWith('/api/lead-source')) return leadHandler(req, res);
  if (pathname.startsWith('/api/')) {
    res.statusCode = 404;
    res.end('{}');
    return;
  }
  return serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`اختبار الواجهة جاهز على http://localhost:${PORT}  (البيانات: ${DB_FILE})`);
});
