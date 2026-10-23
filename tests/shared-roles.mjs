// ===== اختبار «حساب المطوّر»: إداري في القاعدة، سيلز في الشغل =====
// ثلاثة مواضع كانت بتعامله كمدير حقيقي وتسبّب لهProblems:
//   ١) نطاق البيانات → كان يشوف أرقام كل المندوبين وفيدباكهم مختلطة في حسابه.
//   ٢) غرفة المدراء → كانت إشعارات الإدارة ورسائلها توصله وهي مش ليه.
//   ٣) التوزيع التلقائي → كان رقم مندوب ضمن قائمة المختارين، فيأخذ أرقاماً وحده.
//
// التشغيل: node tests/shared-roles.mjs

import assert from 'node:assert/strict';
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
  'إعداد صريح «كل الشركة» يفتح النطاق',
  dataScopeOf({ ...dev, dataScope: 'all' }, all) === null
);
check('حساب بلا معرّف = نطاق فارغ', [...(dataScopeOf({ role: 'sales' }, all) || [])].length === 0);

// ===== ٤) التوزيع التلقائي: حساب المطوّر ليس هدفاً تلقائياً =====
check('السيلز يستقبل أرقاماً', isAssignableSales(sales) === true);
check('قائد الفريق يستقبل أرقاماً', isAssignableSales(lead) === true);
check('الإداري الذي اختار «يعمل سيلزاً» يستقبل', isAssignableSales({ role: 'admin', receivesLeads: true, isActive: true }) === true);
check('الإداري العادي ما يستقبلش', isAssignableSales(ceo) === false);
check('حساب المطوّر ما يستقبلش أرقاماً تلقائية', isAssignableSales(dev) === false);
check('الحساب الموقوف ما يستقبلش', isAssignableSales({ ...sales, isActive: false }) === false);

console.log(`\n✅ نجحت ${passed} فحوصات لحساب المطوّر`);
