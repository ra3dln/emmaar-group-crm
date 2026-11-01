// ===== أرقام إضافية للعميل + ملحوظة (ميزة للسيلز) =====
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, '..', rel), 'utf8');
const app = read('src/App.tsx');
const types = read('src/types.ts');

const { addExtraPhone, removeExtraPhone, extraPhonesOf } = await import('../src/extraPhones.ts');

let passed = 0;
const check = (name, ok, extra = '') => {
  assert.ok(ok, `✗ ${name} ${extra}`);
  passed++;
  console.log(`✓ ${name}`);
};

const AT = '2026-11-01T10:00:00.000Z';
const client = { id: 'c1', name: 'Mero', phone: '01030837411', phones: [] };
const other = { id: 'c2', name: 'Ali', phone: '01111111111', phones: ['01222222222'] };
const all = [client, other];

const added = addExtraPhone(client, '٠١٠٠ ٠٠٠ ٠٠٠٠', 'رقم الواتساب', all, AT);
check('إضافة رقم (حتى بالأرقام العربية والمسافات)', added.ok && added.client.phones[0] === '01000000000');
check('الملحوظة محفوظة على الرقم', added.ok && extraPhonesOf(added.client)[0]?.note === 'رقم الواتساب');
check('وقت التعديل بيتحدّث (عشان المزامنة تعرف الأحدث)', added.ok && added.client.updatedAt === AT);
check('العميل الأصلي ما اتعدّلش (نسخة جديدة)', client.phones.length === 0);

const noNote = addExtraPhone(client, '01000000001', '   ', all, AT);
check('الملحوظة اختيارية', noNote.ok && extraPhonesOf(noNote.client)[0]?.note === '');

check('رقم قصير مرفوض', !addExtraPhone(client, '0123', '', all).ok);
check('رقم العميل نفسه مرفوض', !addExtraPhone(client, '01030837411', '', all).ok);
const dupOther = addExtraPhone(client, '01222222222', '', all);
check('رقم مسجّل على عميل تاني مرفوض (رقم واحد = صاحب واحد)', !dupOther.ok && /Ali/.test(dupOther.error));
check('رقم إضافي مكرر على نفس العميل مرفوض', added.ok && !addExtraPhone(added.client, '01000000000', '', all).ok);

const removed = added.ok ? removeExtraPhone(added.client, '01000000000', AT) : null;
check('شيل الرقم الإضافي وملحوظته', removed && removed.phones.length === 0 && !removed.phoneNotes['01000000000']);

check('النوع فيه phoneNotes', /phoneNotes\?: Record<string, string>;/.test(types));
check(
  'نافذة العميل فيها إضافة رقم + ملحوظة وبتستنى الرفع',
  /إضافة رقم إضافي/.test(app) && /ملحوظة على الرقم \(اختياري\)/.test(app) &&
    /const ok = await pushKey\('crm_clients'\);/.test(app)
);

console.log(`\n✅ نجحت ${passed} فحوصات (أرقام إضافية للعميل)`);
