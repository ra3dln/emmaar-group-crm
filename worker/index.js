// ===== الموقع كله على Cloudflare Workers (مجاني، من غير كارت) =====
// نفس الكود اللي كان شغّال على Vercel: نقاط api/* بنفسها، والواجهة (dist) كملفات ثابتة،
// والمُشغّل الدوري (سحب فيسبوك + التوزيع + الإشعارات) كـ Cron Trigger.
// الفرق الوحيد: الطلب بيتحوّل لشكل Node (req/res) اللي النقاط متعوّدة عليه، وقاعدة D1
// متاحة مباشرة (env.DB) من غير REST ولا توكن.
//
// الإعداد في wrangler.toml، والأسرار (AUTH_SECRET / CRON_SECRET) بـ wrangler secret put.

import { useD1Binding } from '../server/d1.js';

// ===== النقاط (نفس توزيع Vercel وserver.mjs) =====
// بتتحمّل بعد تسجيل القاعدة والمتغيّرات: كل نقطة بتختار مخزنها وقت تحميلها.
const ROUTES = [
  { match: (p) => p === '/api/store', load: () => import('../api/store.js') },
  { match: (p) => p === '/api/auth' || p.startsWith('/api/auth/'), load: () => import('../api/auth.js') },
  { match: (p) => p === '/api/cron', load: () => import('../api/cron.js') },
  { match: (p) => p === '/api/lead-source' || p.startsWith('/api/lead-source/'), load: () => import('../api/lead-source.js') },
  { match: (p) => p === '/api/admin/migrate', load: () => import('../api/admin/migrate.js') },
  { match: (p) => p === '/api/public-page', load: () => import('../api/public-page.js') },
  { match: (p) => p.startsWith('/api/public/'), load: () => import('../api/public/[...path].js') },
  { match: (p) => p.startsWith('/api/push/'), load: () => import('../api/push/[...path].js') },
  // vercel.json rewrites: صفحة الوحدة العامة
  { match: (p) => p === '/p' || p.startsWith('/p/'), load: () => import('../api/public-page.js') },
];

// ===== تجهيز البيئة مرة واحدة لكل نسخة Worker =====
let prepared = false;
const prepare = (env) => {
  if (prepared) return;
  useD1Binding(env.DB);
  // النقاط بتقرا process.env (زي Vercel) — بننقل المتغيّرات النصية والأسرار ليه
  globalThis.process = globalThis.process || { env: {} };
  process.env = process.env || {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') process.env[key] = value;
  }
  prepared = true;
};

// ===== طلب Cloudflare ← req/res بتوع Node =====
const toNodeReq = async (request) => {
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  // الضغط بيعمله Cloudflare نفسه على الحافة — مش محتاجين gzip من جوه النقطة
  delete headers['accept-encoding'];
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const text = hasBody ? await request.text() : '';
  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    // النقاط بتقبل الجسم جاهز (زي Vercel): نص JSON
    body: hasBody ? text : undefined,
    socket: { remoteAddress: headers['cf-connecting-ip'] || '' },
    on() {},
    destroy() {},
  };
};

const makeNodeRes = () => {
  const headers = new Headers();
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(name, value) {
      if (Array.isArray(value)) {
        headers.delete(name);
        for (const v of value) headers.append(name, String(v));
      } else {
        headers.set(name, String(value));
      }
    },
    getHeader(name) {
      return headers.get(name);
    },
    removeHeader(name) {
      headers.delete(name);
    },
    writeHead(status, extra = {}) {
      res.statusCode = status;
      for (const [k, v] of Object.entries(extra || {})) res.setHeader(k, v);
      return res;
    },
    end(body) {
      res.headersSent = true;
      resolveDone(body === undefined || body === null ? null : body);
    },
  };
  return { res, done, headers };
};

const runNodeHandler = async (handler, request, ctx) => {
  const req = await toNodeReq(request);
  const { res, done, headers } = makeNodeRes();
  let failure = null;
  // المعالج ممكن يخلص من غير end، أو يقع — في الحالتين الرد لازم يرجع وما يعلّقش
  const finished = Promise.resolve()
    .then(() => handler(req, res))
    .then(
      () => {
        if (!res.headersSent) res.end();
      },
      (error) => {
        failure = error;
        if (!res.headersSent) res.end();
      }
    );
  // أي شغل بعد الرد (end) بيكمّل في الخلفية
  ctx?.waitUntil?.(finished);
  const body = await done;
  if (failure && res.statusCode < 400 && body === null) throw failure;
  const payload = typeof body === 'string' || body === null || body instanceof Uint8Array ? body : String(body);
  return new Response(request.method === 'HEAD' ? null : payload, { status: res.statusCode, headers });
};

const handlerCache = new Map();
const handlerFor = async (route) => {
  if (!handlerCache.has(route)) handlerCache.set(route, (await route.load()).default);
  return handlerCache.get(route);
};

export default {
  async fetch(request, env, ctx) {
    prepare(env);
    const url = new URL(request.url);
    const route = ROUTES.find((r) => r.match(url.pathname));
    if (!route) return env.ASSETS.fetch(request);
    try {
      const handler = await handlerFor(route);
      return await runNodeHandler(handler, request, ctx);
    } catch (error) {
      console.error('[worker]', url.pathname, error?.stack || error);
      return new Response(JSON.stringify({ error: 'server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  },

  // ===== المُشغّل الدوري (كان خدمة خارجية بتنادي /api/cron على Vercel) =====
  async scheduled(event, env, ctx) {
    prepare(env);
    const secret = String(env.CRON_SECRET || '');
    if (!secret) {
      console.log('[cron] CRON_SECRET مش مضبوط');
      return;
    }
    const route = ROUTES.find((r) => r.match('/api/cron'));
    const handler = await handlerFor(route);
    const request = new Request('https://worker.internal/api/cron', { headers: { authorization: `Bearer ${secret}` } });
    const response = await runNodeHandler(handler, request, ctx);
    console.log('[cron]', response.status, (await response.text()).slice(0, 300));
  },
};
