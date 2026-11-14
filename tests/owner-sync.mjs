// ===== صاحب الرقم في «توزيع الأرقام» = صاحب العميل =====
// الطلب: «في أرقام موجودة في حساب حسن، ولكن في تبويب التوزيع مكتوب إنها مع سلمى — أصلح المزامنة».
// التشغيل: node tests/owner-sync.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const { reconcileOwners } = await import('../shared/ownerSync.js');
const { mergeKeepingRecords } = await import('../server/store.js');
const users = ['u-salma', 'u-hassan', 'u-abdallah'];

// ١) الرقم مع Salma في التوزيع، والعميل في حساب Hassan (يدوي) → العميل يروح لـ Salma
{
  const leads = [{ id: 'l1', phone: '01119899057', salesId: 'u-salma' }];
  const clients = [{ id: 'c1', phone: '+201119899057', userId: 'u-hassan', assignedTo: 'u-hassan', ownerVia: 'manual' }];
  const { clientFixes, leadFixes } = reconcileOwners({ leads, clients, userIds: users });
  check('العميل بياخد صاحب الرقم في التوزيع', clientFixes.length === 1 && clientFixes[0].owner === 'u-salma' && !leadFixes.length);
  check('التظبيط بيتسجّل «يدوي»', clientFixes[0].via === 'manual');

  // وعلى السيرفر: النسخة المظبوطة تكسب ومش بترجع لـ Hassan
  const fixed = [{ ...clients[0], userId: 'u-salma', assignedTo: 'u-salma', ownerVia: 'manual', updatedAt: '2026-11-14T08:00:00.000Z' }];
  const merged = mergeKeepingRecords('crm_clients', fixed, [{ ...clients[0], updatedAt: '2026-11-12T10:00:00.000Z' }], []);
  check('السيرفر بيحتفظ بالصاحب المظبوط (مش بيرجّع Hassan)', merged[0]?.userId === 'u-salma', JSON.stringify(merged[0]));
}

// ٢) الرقم موزّع والعميل مش عند حد → العميل ياخد صاحب الرقم
{
  const { clientFixes } = reconcileOwners({
    leads: [{ id: 'l2', phone: '01000933733', salesId: 'u-hassan', assignedVia: 'manual' }],
    clients: [{ id: 'c2', phone: '01000933733', userId: '', assignedTo: '' }],
    userIds: users,
  });
  check('عميل من غير صاحب بياخد صاحب الرقم', clientFixes.length === 1 && clientFixes[0].owner === 'u-hassan');
}

// ٣) الرقم مش موزّع والعميل عند حد → الرقم ياخد صاحب العميل
{
  const { clientFixes, leadFixes } = reconcileOwners({
    leads: [{ id: 'l3', phone: '01118672258', salesId: '' }],
    clients: [{ id: 'c3', phone: '01118672258', userId: 'u-abdallah' }],
    userIds: users,
  });
  check('الرقم غير الموزّع بياخد صاحب العميل', !clientFixes.length && leadFixes.length === 1 && leadFixes[0].owner === 'u-abdallah');
}

// ٤) حالات ما تتلمسش
{
  const same = reconcileOwners({ leads: [{ id: 'l', phone: '01000000001', salesId: 'u-salma' }], clients: [{ id: 'c', phone: '01000000001', userId: 'u-salma' }], userIds: users });
  check('متطابقين → مفيش تعديل', !same.clientFixes.length && !same.leadFixes.length);
  const deleted = reconcileOwners({ leads: [{ id: 'l', phone: '01000000002', salesId: 'u-gone' }], clients: [{ id: 'c', phone: '01000000002', userId: 'u-salma' }], userIds: users });
  check('صاحب محذوف ما بيتحطش على العميل', !deleted.clientFixes.length);
  const closed = reconcileOwners({ leads: [{ id: 'l', phone: '01000000003', salesId: 'u-hassan', status: 'closed' }], clients: [{ id: 'c', phone: '01000000003', userId: 'u-salma' }], userIds: users });
  check('رقم مقفول ما بيحرّكش العميل', !closed.clientFixes.length);
  const noClient = reconcileOwners({ leads: [{ id: 'l', phone: '01000000004', salesId: 'u-hassan' }], clients: [], userIds: users });
  check('رقم من غير عميل → مفيش تعديل', !noClient.clientFixes.length && !noClient.leadFixes.length);
}

// ٥) أجهزة الإدارة بتطبّق القاعدة
{
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  check('أجهزة الإدارة بتظبط الصاحب تلقائياً', app.includes('reconcileOwners({') && /effectiveRoleOf\(currentUser\) === 'sales'\) return;\s*let all: Client\[\] = \[\];[\s\S]{0,400}reconcileOwners/.test(app));
}

console.log(`\n✅ نجحت ${passed} فحوصات (صاحب الرقم في التوزيع = صاحب العميل)`);
