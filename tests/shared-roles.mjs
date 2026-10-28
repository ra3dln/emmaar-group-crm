// ===== اختبار «حساب المطوّر»: إداري في القاعدة، سيلز في الشغل =====
// ثلاثة مواضع كانت بتعامله كمدير حقيقي وتسبّب لهProblems:
//   ١) نطاق البيانات → كان يشوف أرقام كل المندوبين وفيدباكهم مختلطة في حسابه.
//   ٢) غرفة المدراء → كانت إشعارات الإدارة ورسائلها توصله وهي مش ليه.
//   ٣) التوزيع التلقائي → كان رقم مندوب ضمن قائمة المختارين، فيأخذ أرقاماً وحده.
//
// التشغيل: node tests/shared-roles.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  dataScopeOf,
  effectiveRoleOf,
  isAdminAccount,
  isDeveloperAccount,
  isManagerAccount,
} from '../shared/roles.js';
import { isAssignableSales } from '../shared/autoAssign.js';

let passed = 0;
const check = (label, condition, extra = '') => {
  assert.ok(condition, `✗ ${label} ${extra}`);
  passed += 1;
  console.log(`✓ ${label}`);
};

const ceo = { id: 'admin-1', username: 'boss', name: 'الإدارة', role: 'admin', isActive: true };
const dev = { id: 'dev-1', username: 'mohamed', name: 'مطور', role: 'admin', developer: true, isActive: true };
const sales = { id: 'sales-1', username: 'ahmed', name: 'أحمد', role: 'sales', team: 'A', isActive: true };
const sales2 = { id: 'sales-2', username: 'sara', name: 'سارة', role: 'sales', isActive: true };
const lead = { id: 'lead-1', username: 'mostafa', name: 'مصطفى', role: 'supervisor', team: 'A', isActive: true };
const leadNoTeam = { id: 'lead-2', username: 'haidy', name: 'هايدي', role: 'supervisor', team: '', isActive: true };
// إداري وسيلز في نفس الوقت (فريدة): إداري في القاعدة، يستقبل أرقاماً، ويظهر «CEO»
// بلا أي لقب «مطوّر» — وهذا الفرق الوحيد عن حساب المطوّر (محمد).
const exec = { id: 'exec-1', username: 'farida', name: 'فريدة', role: 'admin', receivesLeads: true, dataScope: 'own', isActive: true };
const all = [ceo, dev, sales, sales2, lead, leadNoTeam];

// ===== ١) مين حساب المطوّر =====
check('علامة developer تعرّف حساب المطوّر', isDeveloperAccount(dev) === true);
check('اسم المستخدم المحفوظ برضه (بيانات قديمة)', isDeveloperAccount({ username: 'mohamed' }) === true);
check('الحساب العادي مش مطوّر', isDeveloperAccount(ceo) === false && isDeveloperAccount(sales) === false);

// ===== ٢) الرتبة السلوكية =====
check('حساب المطوّر سلوكه سيلز', effectiveRoleOf(dev) === 'sales');
check('الإدارة سلوكها إدارة', effectiveRoleOf(ceo) === 'admin');
check('السيلز سلوكه سيلز', effectiveRoleOf(sales) === 'sales');
check('حساب المطوّر مش من غرفة المدراء', isManagerAccount(dev) === false);
check('الإدارة وقائد الفريق من غرفة المدراء', isManagerAccount(ceo) === true && isManagerAccount(lead) === true);
check('صلاحيات الإدارة (إدارة الحسابات) باقية للمطوّر', isAdminAccount(dev) === true);

// ===== الإداري الذي يعمل سيلزاً (فريدة): سلوك سيلز، لقب CEO، بلا «مطوّر» =====
check('الإداري الذي يستقبل أرقاماً سلوكه سيلز (يظهر في الفيدباك والحضور والتوزيع)', effectiveRoleOf(exec) === 'sales');
check('ما يتكتبش عليه لقب «مطوّر»', isDeveloperAccount(exec) === false);
check('صلاحياته الإدارية باقية (رتبته admin)', isAdminAccount(exec) === true);
check('نطاق بياناته «بياناته فقط» كما اختار', [...(dataScopeOf(exec, all) || [])].join(',') === 'exec-1');
check('الإداري الذي يعمل سيلزاً يستقبل أرقاماً', isAssignableSales(exec) === true);

// ===== ٣) نطاق البيانات =====
check('الإدارة (CEO) ترى كل الشركة', dataScopeOf(ceo, all) === null);
check('حساب المطوّر محدود ببياناته هو', [...(dataScopeOf(dev, all) || [])].join(',') === 'dev-1');
check('السيلز لا يرى غيره', [...(dataScopeOf(sales, all) || [])].join(',') === 'sales-1');
check(
  'قائد الفريق يرى فريقه',
  [...(dataScopeOf(lead, all) || [])].sort().join(',') === 'lead-1,sales-1'
);
check('قائد الفريق بلا فريق يرى نفسه فقط', [...(dataScopeOf(leadNoTeam, all) || [])].join(',') === 'lead-2');
check(
  'إعداد صريح «بياناتي فقط» على أي حساب (منه الإدارة)',
  [...(dataScopeOf({ ...ceo, dataScope: 'own' }, all) || [])].join(',') === 'admin-1'
);
check(
  'إعداد صريح «كل الشركة» يفتح النطاق (لحساب عادي)',
  dataScopeOf({ ...sales, dataScope: 'all' }, all) === null &&
    dataScopeOf({ ...exec, dataScope: 'all' }, all) === null
);
check(
  'حساب المطوّر: نطاقه «بياناته هو» حتى لو سجل فيه «كل البيانات» (نسخة قديمة)',
  dataScopeOf({ ...dev, dataScope: 'all' }, all) !== null &&
    [...(dataScopeOf({ ...dev, dataScope: 'all' }, all) || [])].join(',') === 'dev-1' &&
    dataScopeOf({ ...dev, role: 'sales', dataScope: 'all' }, all) !== null
);
check('حساب بلا معرّف = نطاق فارغ', [...(dataScopeOf({ role: 'sales' }, all) || [])].length === 0);

// ===== ٤) التوزيع التلقائي: حساب المطوّر هدف عادي مثل أي مندوب =====
check('السيلز يستقبل أرقاماً', isAssignableSales(sales) === true);
check('قائد الفريق يستقبل أرقاماً', isAssignableSales(lead) === true);
check('الإداري الذي اختار «يعمل سيلزاً» يستقبل', isAssignableSales({ role: 'admin', receivesLeads: true, isActive: true }) === true);
check('الإداري العادي ما يستقبلش', isAssignableSales(ceo) === false);
check('حساب المطوّر يستقبل أرقاماً ويظهر في التوزيع', isAssignableSales(dev) === true);
check('الحساب الموقوف ما يستقبلش', isAssignableSales({ ...sales, isActive: false }) === false);

// ===== ٥) شاشات الحضور والفيدباك والمحادثات بتستخدم الرتبة السلوكية =====
// العطل المُبلَّغ عنه: «حساب محمد مش ظاهر في خانة الحضور» — لأنه إداري في القاعدة
// وكانت الشاشة تستثني `role !== admin` فيسقط من القائمة مع المدراء.
const app = fs.readFileSync('src/App.tsx', 'utf8');
check(
  'شاشة الحضور (اليومي والشهري) تعرض الإداري الذي يعمل سيلزاً',
  /function AdminAttendanceView[\s\S]{0,4000}effectiveRoleOf\(u\) !== 'admin'/.test(app) &&
    /AttendanceMonthlyReport[\s\S]{0,4000}effectiveRoleOf\(user\) !== 'admin'/.test(app)
);
check(
  'قوائم السيلز في المراحل والتقارير والإضافة بتشمل حساب المطوّر',
  (app.match(/\['sales', 'supervisor'\]\.includes\(effectiveRoleOf\(/g) || []).length >= 4
);
check(
  'قائمة المحادثات بتعرض حساب المطوّر مع الفريق',
  /const people = \(users \|\| \[\]\)\.filter\(\(u: User\) => effectiveRoleOf\(u\) !== 'admin'\)/.test(app)
);
check(
  'لوحة الفيدباك اليومي تعرض أرقام المندوب حتى اللي مالها كومنت',
  !/filter\(\(entry\) => entry\.items\.length > 0\)/.test(app) &&
    /const all = Array\.from\(map\.values\(\)\)/.test(app)
);
check(
  'بطاقة الفيدباك تكتب CEO للإداري الذي يعمل سيلزاً و«سيلز» للمطوّر',
  /isDeveloperAccount\(user\) \? 'سيلز' : user\.role === 'admin' \? 'CEO'/.test(app)
);
check('عنوان الإدارة في الشريط «إعمار جروب»', app.includes('إعمار جروب — إدارة العملاء'));

// ===== التوزيع/الإلغاء يظهر فوراً بلا ريفرش =====
// لوحة التوزيع كانت تتحدّث بعد المزامنة فقط (fullLeads)، فيبدو توزيع الرقم على
// سيلز آخر أو سحبه من العهدة كأنه لم يُحفظ حتى يعمل المستخدم ريفرش.
check(
  'تعديل التوزيع يحدّث لوحات الإدارة فوراً (بلا ريفرش)',
  /localStorage\.setItem\('crm_assigned_leads'[\s\S]{0,700}if \(currentUser\?\.role !== 'sales'\) setFullLeads\(next\);/.test(app)
);

// ===== ٦) حساب المطوّر (system dev): أعلى صلاحية — يدخل أي حساب ومنهم الـ CEO =====
// الطلب: «حساب محمد يقدر يدخل عادي لحسابات الـ CEO كاملة» — يعني الانتحال
// (الدخول لحساب غيره بدون كلمة مرور) متاح لحساب المطوّر حتى مع حساب الـ CEO
// (اللي مكنش ينفع حد يدخل عليه غيره).
check(
  'حساب المطوّر يدخل أي حساب (منهم الـ CEO)',
  /if \(isDeveloperAccount\(currentUser\)\) return true;/.test(app)
);
check(
  'الإدارة العادية ما تدخلش حساب الـ CEO',
  /return user\.role !== 'admin' \|\| !!user\.developer;/.test(app)
);
check(
  'حساب المطوّر ما يدخلش على نفسه',
  /if \(user\.id === currentUser\.id\) return false;/.test(app)
);
check(
  'الحساب الموقوف ما ينفعش الدخول عليه',
  /if \(!user\.isActive\) return false;/.test(app)
);
check(
  'نص التلميح يوضّح إن حساب الـ CEO متاح لحساب المطوّر فقط',
  /حساب إداري — الدخول متاح لحساب المطوّر/.test(app)
);

console.log(`\n✅ نجحت ${passed} فحوصات لحساب المطوّر`);
