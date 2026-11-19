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

// ===== تعديل اسم العميل ورقمه =====
{
  const { editClientBasics } = await import('../src/extraPhones.ts');
  const base = { id: 'c1', name: 'أحمد', phone: '01000000001', phones: [], phoneNotes: {} };
  const others = [base, { id: 'c2', name: 'منى', phone: '01000000002' }];
  const renamed = editClientBasics(base, '  أحمد علي ', '01000000001', others);
  assert.ok(renamed.ok && renamed.client.name === 'أحمد علي' && renamed.client.phone === '01000000001' && renamed.client.phones.length === 0, '✗ تعديل الاسم بس');
  passed += 1; console.log('✓ تعديل الاسم بس من غير ما الرقم يتغيّر');
  const moved = editClientBasics(base, 'أحمد', '01000000009', others);
  assert.ok(moved.ok && moved.client.phone === '01000000009' && moved.client.phones.includes('01000000001') && moved.client.phoneNotes['01000000001'] === 'الرقم القديم', '✗ تغيير الرقم');
  passed += 1; console.log('✓ تغيير الرقم بيحفظ القديم كرقم إضافي (التاريخ ما يضيعش)');
  const taken = editClientBasics(base, 'أحمد', '01000000002', others);
  assert.ok(!taken.ok && /عميل تاني/.test(taken.error), '✗ رقم عميل تاني');
  passed += 1; console.log('✓ رقم عند عميل تاني مرفوض');
  assert.ok(!editClientBasics(base, '', '01000000001', others).ok && !editClientBasics(base, 'أحمد', '12', others).ok, '✗ مدخلات ناقصة');
  passed += 1; console.log('✓ اسم فاضي أو رقم ناقص مرفوض');
  const back = editClientBasics(moved.client, 'أحمد', '01000000001', others);
  assert.ok(back.ok && back.client.phone === '01000000001' && !back.client.phones.includes('01000000001'), '✗ رجوع للرقم القديم');
  passed += 1; console.log('✓ الرجوع للرقم القديم بيشيله من الأرقام الإضافية');
  assert.ok(app.includes('editClientBasics(stored, basicsForm.name, basicsForm.phone, all)') && app.includes('title="تعديل الاسم والرقم"'), '✗ زرار التعديل');
  passed += 1; console.log('✓ زرار «تعديل الاسم والرقم» في تفاصيل العميل وبيحفظ على السيرفر');
}

// ===== «تم الرد» مالوش ميعاد تذكير تلقائي =====
assert.ok(/if \(r === 'answered'\) \{\s*suggestedAtRef\.current = '';\s*setNextCallAt\(''\);/.test(app) && !/120 : 1440/.test(app), '✗ ميعاد تم الرد');
passed += 1; console.log('✓ «تم الرد» ما بيحطش ميعاد تذكير لوحده (السيلز يختاره)');

console.log(`\n✅ نجحت ${passed} فحوصات (أرقام إضافية للعميل)`);
