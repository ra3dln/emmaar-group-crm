// ===== صاحب الرقم في «توزيع الأرقام» = صاحب العميل =====
// الطلب: «الأرقام دي مع حسن وظاهرة في التوزيع إنها مع سلمى — عايزها تبان مع حسن،
// ومتحصلش اللخبطة دي تاني». الحساب اللي فيه العميل هو الأساس.
// التشغيل: node tests/owner-sync.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const { reconcileOwners, OWNER_SETTLE_MS } = await import('../shared/ownerSync.js');
const users = ['u-salma', 'u-hassan', 'u-abdallah'];
const NOW = Date.parse('2026-11-14T15:00:00.000Z');
const OLD = '2026-11-12T10:00:00.000Z';

// ١) العميل في حساب Hassan والتوزيع مكتوب Salma → التوزيع يكتب Hassan (العميل ما يتحركش)
{
  const { clientFixes, leadFixes } = reconcileOwners({
    leads: [{ id: 'l1', phone: '01119899057', salesId: 'u-salma', assignedAt: OLD }],
    clients: [{ id: 'c1', phone: '+201119899057', userId: 'u-hassan', assignedTo: 'u-hassan', updatedAt: OLD }],
    userIds: users,
    now: NOW,
  });
  check('التوزيع بياخد صاحب الحساب اللي فيه العميل', leadFixes.length === 1 && leadFixes[0].owner === 'u-hassan');
  check('العميل ما بيتحركش من حسابه', clientFixes.length === 0);
}

// ٢) العميل مش عند حد والرقم موزّع → العميل يروح لصاحب الرقم
{
  const { clientFixes, leadFixes } = reconcileOwners({
    leads: [{ id: 'l2', phone: '01000933733', salesId: 'u-hassan', assignedVia: 'manual', assignedAt: OLD }],
    clients: [{ id: 'c2', phone: '01000933733', userId: '', assignedTo: '', updatedAt: OLD }],
    userIds: users,
    now: NOW,
  });
  check('عميل من غير صاحب بياخد صاحب الرقم («يدوي»)', clientFixes.length === 1 && clientFixes[0].owner === 'u-hassan' && clientFixes[0].via === 'manual' && !leadFixes.length);
}

// ٣) الرقم مش موزّع والعميل عند حد → الرقم ياخد صاحب العميل
{
  const { leadFixes } = reconcileOwners({
    leads: [{ id: 'l3', phone: '01118672258', salesId: '', assignedAt: OLD }],
    clients: [{ id: 'c3', phone: '01118672258', userId: 'u-abdallah', updatedAt: OLD }],
    userIds: users,
    now: NOW,
  });
  check('الرقم غير الموزّع بياخد صاحب العميل', leadFixes.length === 1 && leadFixes[0].owner === 'u-abdallah');
}

// ٤) توزيع لسه بيتحفظ (آخر دقيقتين) ما بيتلمسش — ما نرجّعش الرقم لصاحبه القديم
{
  const justNow = new Date(NOW - 30 * 1000).toISOString();
  const fresh = reconcileOwners({
    leads: [{ id: 'l4', phone: '01000000005', salesId: 'u-salma', assignedAt: justNow }],
    clients: [{ id: 'c4', phone: '01000000005', userId: 'u-hassan', updatedAt: OLD }],
    userIds: users,
    now: NOW,
  });
  check('رقم اتوزّع من ٣٠ ثانية ما بيرجعش لصاحب العميل القديم', !fresh.clientFixes.length && !fresh.leadFixes.length);
  const later = reconcileOwners({
    leads: [{ id: 'l4', phone: '01000000005', salesId: 'u-salma', assignedAt: justNow }],
    clients: [{ id: 'c4', phone: '01000000005', userId: 'u-hassan', updatedAt: OLD }],
    userIds: users,
    now: NOW + OWNER_SETTLE_MS,
  });
  check('بعد ما يستقر بيتطابق', later.leadFixes.length === 1);
}

// ٥) حالات ما تتلمسش
{
  const same = reconcileOwners({ leads: [{ id: 'l', phone: '01000000001', salesId: 'u-salma' }], clients: [{ id: 'c', phone: '01000000001', userId: 'u-salma' }], userIds: users, now: NOW });
  check('متطابقين → مفيش تعديل', !same.clientFixes.length && !same.leadFixes.length);
  const deleted = reconcileOwners({ leads: [{ id: 'l', phone: '01000000002', salesId: 'u-salma' }], clients: [{ id: 'c', phone: '01000000002', userId: 'u-gone' }], userIds: users, now: NOW });
  check('صاحب محذوف ما بيتحطش على الرقم', !deleted.leadFixes.length);
  const closed = reconcileOwners({ leads: [{ id: 'l', phone: '01000000003', salesId: 'u-hassan', status: 'closed' }], clients: [{ id: 'c', phone: '01000000003', userId: 'u-salma' }], userIds: users, now: NOW });
  check('رقم مقفول ما بيتلمسش', !closed.clientFixes.length && !closed.leadFixes.length);
  const noClient = reconcileOwners({ leads: [{ id: 'l', phone: '01000000004', salesId: 'u-hassan' }], clients: [], userIds: users, now: NOW });
  check('رقم من غير عميل → مفيش تعديل', !noClient.clientFixes.length && !noClient.leadFixes.length);
}

// ٦) أجهزة الإدارة بتطبّق القاعدة
{
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  check('أجهزة الإدارة بتظبط الصاحب تلقائياً', app.includes('reconcileOwners({') && /effectiveRoleOf\(currentUser\) === 'sales'\) return;\s*let all: Client\[\] = \[\];[\s\S]{0,400}reconcileOwners/.test(app));
}

console.log(`\n✅ نجحت ${passed} فحوصات (صاحب الرقم في التوزيع = صاحب العميل)`);
