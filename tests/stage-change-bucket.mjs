// ===== تغيير المرحلة بيحرّك الرقم من Fresh =====
// الشكوى: «رقم فريش، بيغيّر الـ stage لفولو اب لكن بيفضل فريش».
// السبب: حدث تغيير المرحلة ما كانش بيحمل حالة، والخانة بتتحدد بآخر حالة
// (Fresh قديمة) — وكمان التغيير ما كانش بيترفع للسيرفر.
// التشغيل: node tests/stage-change-bucket.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { feedbackBucketOf, STAGE_TO_FEEDBACK_STATUS } = await import('../src/feedbackBuckets.ts');
let passed = 0;
const check = (label, ok, extra = '') => { assert.ok(ok, `✗ ${label} ${extra}`); passed += 1; console.log(`✓ ${label}`); };

const fresh = {
  id: 'c1', stage: 'new',
  activities: [{ id: 'a1', type: 'feedback', status: 'fresh-stage', text: 'No answer', at: '2026-11-18T09:00:00.000Z' }],
};
check('الرقم في Fresh قبل التغيير', feedbackBucketOf(fresh) === 'fresh-stage');
const moved = {
  ...fresh, stage: 'contacted',
  activities: [{ id: 'a2', type: 'stage', status: STAGE_TO_FEEDBACK_STATUS.contacted, text: 'تغيير المرحلة: جديد ← تم التواصل', at: '2026-11-21T10:00:00.000Z' }, ...fresh.activities],
};
check('بعد تغيير المرحلة لفولو اب بيروح Follow Up', feedbackBucketOf(moved) === 'follow-up', feedbackBucketOf(moved));

const app = fs.readFileSync('src/App.tsx', 'utf8');
const i = app.indexOf('const handleUpdateClientStage');
const block = app.slice(i, i + 3000);
check('حدث تغيير المرحلة بيحمل الحالة', /STAGE_TO_FEEDBACK_STATUS\[/.test(block) && /status: stageStatus/.test(block));
check('تغيير المرحلة بيترفع للسيرفر', /pushKey\('crm_clients'\)/.test(block));

console.log(`\n✅ نجحت ${passed} فحوصات (تغيير المرحلة بيحرّك الرقم من Fresh)`);

// ===== الرقم راجع لنفس المندوب بعد نقل بالغلط =====
{
  const { ownerAlreadyWorked } = await import('../src/feedbackBuckets.ts');
  const back = {
    id: 'c2', userId: 'abd', stage: 'new', transferredFrom: 'salma', transferredAt: '2026-11-21T19:41:00.000Z',
    activities: [
      { id: 't', type: 'assign', text: 'تم تخصيص العميل إلى Abdallah', at: '2026-11-21T19:41:00.000Z' },
      { id: 'f', type: 'feedback', status: 'follow-up', authorId: 'abd', text: 'متابعة', at: '2026-11-21T18:34:00.000Z' },
    ],
  };
  if (!ownerAlreadyWorked(back) || feedbackBucketOf(back) !== 'follow-up') {
    console.error('✗ الرقم الراجع لصاحبه رجع Fresh', feedbackBucketOf(back)); process.exit(1);
  }
  console.log('✓ الرقم الراجع لنفس المندوب بيفضل في المرحلة اللي اختارها');
  const other = { ...back, userId: 'salma' };
  if (feedbackBucketOf(other) !== 'fresh-stage') { console.error('✗ النقل لمندوب جديد لازم يبقى Fresh'); process.exit(1); }
  console.log('✓ النقل لمندوب جديد لسه بينزل Fresh');
}
