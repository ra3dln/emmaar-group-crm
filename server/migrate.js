// ===== نقل كل البيانات من مخزن لآخر (مثلاً Supabase → Cloudflare D1) =====
// الهدف: «كأننا معملناش نقل» — كل السجلات وكل الإعدادات، بدون ما نمسح
// أي حاجة اتكتبت على الوجهة بعد النقل (زي شغل الفريق النهاردة).
//
// القواعد:
//   • السجلات بتتدمج بالمعرّف (server/store.js: mergeKeepingRecords) — الأحدث وقتاً يكسب.
//   • شواهد الحذف بتتدمج اتحاداً: سجل محذوف في أي ناحية يفضل محذوف.
//   • الإعدادات المفردة (توكن فيسبوك / مفاتيح الإشعارات) بتتنقل لو الوجهة فاضية،
//     وبتتكتب بالعافية لو overwrite=true.
//   • رقم النسخة = الأكبر من الاتنين + ١، فكل الأجهزة تنزّل النسخة الجديدة مرة واحدة.
//
// الدالة مستقلة عن نوع المخزن: أي كائنين بنفس الواجهة (load/save/jsonStore) يشتغلوا.

import { mergeKeepingRecords, mergeTombstones, sanitizeMergedKey } from './store.js';

// إعدادات سحب الأرقام (توكن فيسبوك والصفحات والفورمات) ومفاتيح الإشعارات
export const SETTINGS_KEYS = ['crm:lead-source:config', 'crm:push:vapid', 'crm:push:state'];

const TOMBSTONE_KEY = 'crm_tombstones';
const asArray = (value) => (Array.isArray(value) ? value : []);
// كائن آمن (للبيانات والإعدادات القادمة من أي مخزن)
export const asRecord = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asObject = asRecord;

export async function copyAllFromSource({ source, target, settingsKeys = SETTINGS_KEYS, overwrite = false }) {
  if (!source || !target) throw new Error('مصدر أو وجهة غير محددة');

  const src = (await source.load()) || {};
  const dst = (await target.load()) || {};
  const srcData = asObject(src.data);
  const dstData = asObject(dst.data);

  // شواهد الحذف: اتحاد الناحيتين (الأحدث وقتاً لكل شاهد)
  const srcTombs = asArray(srcData[TOMBSTONE_KEY]);
  const dstTombs = asArray(dstData[TOMBSTONE_KEY]);
  const tombstones = mergeTombstones(dstTombs, srcTombs);

  const keys = new Set([...Object.keys(srcData), ...Object.keys(dstData)]);
  keys.delete(TOMBSTONE_KEY);

  const merged = { ...dstData };
  const records = {};
  for (const key of keys) {
    const incoming = asArray(srcData[key]);
    const stored = asArray(dstData[key]);
    if (!incoming.length && !stored.length) {
      // مفتاح فاضي في الناحيتين: نسيبه زي ما هو (مش بنضيف مفاتيح فاضية)
      continue;
    }
    const rows = sanitizeMergedKey(key, mergeKeepingRecords(key, incoming, stored, tombstones));
    merged[key] = rows;
    records[key] = { source: incoming.length, target: stored.length, merged: rows.length };
  }
  merged[TOMBSTONE_KEY] = tombstones;

  const version = Math.max(Number(src.version) || 0, Number(dst.version) || 0) + 1;
  await target.save({ version, data: merged });

  // ===== الإعدادات المفردة =====
  const settings = {};
  for (const key of settingsKeys) {
    let value = {};
    try {
      value = asObject(await source.jsonStore(key).load());
    } catch (err) {
      settings[key] = { copied: false, error: String(err?.message || err) };
      continue;
    }
    const size = Object.keys(value).length;
    if (!size) {
      settings[key] = { copied: false, reason: 'empty' };
      continue;
    }
    const existing = asObject(await target.jsonStore(key).load());
    if (Object.keys(existing).length && !overwrite) {
      settings[key] = { copied: false, reason: 'target-not-empty', fields: size };
      continue;
    }
    await target.jsonStore(key).save(value);
    settings[key] = { copied: true, fields: size };
  }

  return { version, records, settings, tombstones: tombstones.length };
}
