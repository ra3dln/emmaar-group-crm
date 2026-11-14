// ===== الترتيب من الأحدث للأقدم في كل القوائم =====
// الطلب: العملاء في All Leads وفي كل التصنيفات (عملاء كامبين، المراحل، التوزيع…)
// يترتبوا من الأجدد للأقدم.
// التشغيل: node tests/newest-first.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const { newestFirst, campaignTimeMs } = await import('../shared/leadClients.js');

const list = [
  { id: 'old', createdAt: '2026-10-01T10:00:00.000Z' },
  { id: 'campaign-new', campaignAt: '2026-11-14T08:00:00.000Z', createdAt: '2026-10-02T10:00:00.000Z' },
  { id: 'no-date' },
  { id: 'mid', createdAt: '2026-11-01T10:00:00.000Z' },
];
const order = newestFirst(list).map((x) => x.id).join(',');
check('الأحدث فوق والأقدم تحت', order === 'campaign-new,mid,old,no-date', order);
check('وقت التسجيل في الكامبين أولى من وقت الإضافة', campaignTimeMs(list[1]) > campaignTimeMs({ createdAt: '2026-11-13T00:00:00.000Z' }));
check('القائمة الأصلية ما بتتغيّرش', list[0].id === 'old');
const rows = [{ lead: list[0] }, { client: list[1] }];
check('الترتيب بيشتغل على كارت فيه عميل أو رقم', newestFirst(rows, (r) => r.client || r.lead)[0].client?.id === 'campaign-new');

const app = fs.readFileSync('src/App.tsx', 'utf8');
check('All Leads (صفحة الأرقام) الأحدث فوق', app.includes('return newestFirst(list.filter((row) => matchLeadSearch(row, query, field)), (row) => row.client || row.lead);'));
check('لوحة الحالة عند السيلز الأحدث فوق', /const items: any\[\] = newestFirst\(/.test(app));
check('المراحل عند الإدارة الأحدث فوق', /const openList = newestFirst\(/.test(app));
check('عملاء كامبين الأحدث فوق', /const visible = newestFirst\(campaignClients\.filter/.test(app) && /const visibleLeads = newestFirst\(campaignLeads\.filter/.test(app));
check('توزيع الأرقام الأحدث فوق', /const visible = newestFirst\(formLeads/.test(app));

console.log(`\n✅ نجحت ${passed} فحوصات (الترتيب من الأحدث للأقدم)`);
