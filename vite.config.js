import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStoreHandler, fileStorage } from "./server/store.js";
import { createLeadSourceHandler, startAutoImport } from "./server/leadSource.js";
import { createPushHandler, startPushLoop } from "./server/push.js";
import { createPublicHandler } from "./server/publicPage.js";
import { createAuthHandler } from "./server/authApi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
// يمكن تشغيل نسخة تجريبية معزولة تماماً عبر متغيرات البيئة (CRM_DB_FILE وغيرها) بدون لمس بيانات الشركة
const pickFile = (envName, fallback) => (process.env[envName] ? path.resolve(process.env[envName]) : path.join(DATA_DIR, fallback));
const DB_FILE = pickFile("CRM_DB_FILE", "db.json");
const SOURCE_FILE = pickFile("CRM_SOURCE_FILE", "lead-source.json");
const VAPID_FILE = pickFile("CRM_VAPID_FILE", "vapid.json");
const PUSH_STATE = pickFile("CRM_PUSH_STATE", "push-state.json");

// ===== مفتاح توقيع الجلسات على سيرفر المكتب =====
// نفس الحماية المفروضة على الاستضافة تُفرض هنا أيضاً: أي شخص على نفس الشبكة
// يعرف عنوان السيرفر لا يرى بيانات العملاء بلا تسجيل دخول.
// المفتاح: AUTH_SECRET من البيئة أو من .env، وإلا يُولَّد مرة واحدة ويُحفظ في
// ملف محلي مستقل خارج git (فتبقى الجلسات صالحة بعد إعادة التشغيل).
const ENV_FILE = loadEnv(process.env.NODE_ENV || "development", __dirname, "");
const LOCAL_SECRET_FILE = pickFile("CRM_AUTH_SECRET_FILE", ".auth-secret");
const authSecret = (() => {
  const fromEnv = String(process.env.AUTH_SECRET || ENV_FILE.AUTH_SECRET || "").trim();
  if (fromEnv.length >= 16) return fromEnv;
  try {
    const saved = fs.readFileSync(LOCAL_SECRET_FILE, "utf8").trim();
    if (saved.length >= 16) return saved;
  } catch {
    /* يُولَّد جديد */
  }
  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(LOCAL_SECRET_FILE), { recursive: true });
    fs.writeFileSync(LOCAL_SECRET_FILE, generated, "utf8");
  } catch {
    /* التشغيل بلا حفظ — تكفي جلسته الحالية */
  }
  return generated;
})();
const AUTH_ENV = { ...process.env, ...ENV_FILE, AUTH_SECRET: authSecret };

// ===== تسجيل الدخول على سيرفر المكتب (نفس منطق api/auth.js بالحرف) =====
function localAuth() {
  const handler = createAuthHandler({ storage: fileStorage(DB_FILE), env: AUTH_ENV });
  const mount = (server) => {
    server.middlewares.use((req, res, next) => {
      if (!(req.url || "").startsWith("/api/auth")) return next();
      handler(req, res);
    });
  };
  return {
    name: "local-auth",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

// ===== إشعارات حقيقية تصل والموقع مقفول (Web Push) + حلقة إرسال تلقائية =====
let pushLoopStarted = false;
function pushNotifications() {
  const { handler } = createPushHandler({
    storeFile: DB_FILE,
    vapidFile: VAPID_FILE,
    stateFile: PUSH_STATE,
    auth: AUTH_ENV,
  });
  const mount = (server) => {
    server.middlewares.use((req, res, next) => {
      if (!(req.url || "").startsWith("/api/push")) return next();
      handler(req, res);
    });
    if (!pushLoopStarted) {
      pushLoopStarted = true;
      startPushLoop({ storeFile: DB_FILE, vapidFile: VAPID_FILE, stateFile: PUSH_STATE, intervalMs: 45000 });
    }
  };
  return {
    name: "web-push-notifications",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

// ===== سحب الأرقام تلقائياً من المصدر (ملف منشور أو فيسبوك) =====
let autoImportStarted = false;
function autoImport() {
  return {
    name: "lead-auto-import",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url || "").startsWith("/api/lead-source")) return next();
        createLeadSourceHandler({ storeFile: DB_FILE, configFile: SOURCE_FILE, auth: AUTH_ENV })(req, res);
      });

      startLoop();
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url || "").startsWith("/api/lead-source")) return next();
        createLeadSourceHandler({ storeFile: DB_FILE, configFile: SOURCE_FILE, auth: AUTH_ENV })(req, res);
      });
      startLoop();
    },
  };
}

function startLoop() {
  if (autoImportStarted) return;
  autoImportStarted = true;
  startAutoImport({ storeFile: DB_FILE, configFile: SOURCE_FILE });
}

// ===== قاعدة بيانات بسيطة في ملف JSON (بدون أي مكتبات خارجية) =====
// كل الأجهزة على نفس الشبكة تقرأ وتكتب نفس الملف => نفس البيانات على الكمبيوتر والموبايل.
// على الاستضافة (Vercel) يعمل نفس المنطق لكن بالتخزين السحابي — انظر api/store.js
function jsonFileStore() {
  // auth: بوابة الجلسة — لا قراءة ولا كتابة بلا تسجيل دخول صحيح
  const handler = createStoreHandler({
    ...fileStorage(DB_FILE),
    auth: AUTH_ENV,
  });

  const mount = (server) => {
    server.middlewares.use((req, res, next) => {
      if (!(req.url || "").startsWith("/api/store")) return next();
    // بدون قاعدة بيانات على Vercel، الطلبات لـ /api/store بترجع 503 من الـ api handler.
    // محلياً فقط على سيرفر المكتب (file-based) بيكون فيه /api/store شغال،
    // لكن على الاستضافة (Vercel) الـ api/store.js هيكون موجود وبيعطي 503 explicitly.
      handler(req, res);
    });
  };

  return {
    name: "json-file-store",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

// ===== الصفحة العامة لكل عقار (رابط يُشارَك مع العملاء) =====
// /p/<id> صفحة عرض الوحدة، و /api/public/* لتسجيل العميل من داخل الصفحة مباشرة في قاعدة البيانات
function publicSharePages() {
  const handler = createPublicHandler({ storeFile: DB_FILE });
  const mount = (server) => {
    server.middlewares.use((req, res, next) => {
      const url = req.url || "";
      const isPublic = url === "/p" || url.startsWith("/p/") || url.startsWith("/p?") || url.startsWith("/api/public");
      if (!isPublic) return next();
      handler(req, res);
    });
  };
  return {
    name: "public-share-pages",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

// HTTPS مفعّل حتى يعمل تحديد الموقع (Geolocation) على الهاتف عبر رابط الشبكة
//
// ملاحظة مهمة للاستضافة (Vercel): كل الإضافات التي تعمل على «سيرفر الشركة»
// (ملف البيانات، سحب الأرقام، الإشعارات، الصفحة العامة) تُحمَّل في وضع التشغيل
// المحلي فقط. عند البناء للنشر لا تعمل، لأن الاستضافة تستخدم api/*.js مع Redis
// ولأن هذه الإضافات تكتب ملفات — والبناء يجب أن يبقى ناجحاً بلا أي ملفات جانبية.
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    ...(command === 'serve'
      ? [basicSsl(), localAuth(), jsonFileStore(), autoImport(), pushNotifications(), publicSharePages()]
      : []),
  ],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    https: true,
    hmr: {
      port: 3000,
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    https: true,
  },
}));
