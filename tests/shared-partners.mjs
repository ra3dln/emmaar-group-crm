// ===== السيلز المشترك على العميل =====
//
// القواعد:
//   • صاحب الرقم بس يضيف/يشيل سيلز شريك (الشريك ما يقدرش).
//   • الشريك يستلم العميل/الرقم، ويكتب كومنتات وياخد action عليه.
//   • الكومنتات والمكالمات على الرقم المشترك بتتحمّل للطرفين.
//   • خانة «Shared Leads» = الأرقام اللي أنا شريك فيها بس.
//   • الشراكة على الرقم الموزّع بتفضل لما يتحوّل لعميل.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, '..', rel), 'utf8');

const app = read('src/App.tsx');
const panel = read('src/PartnerPanel.tsx');
const css = read('src/index.css');

const {
  partnerIdsOf, isRecordOwner, isPartnerOf, withPartner, withoutPartner,
  partnerPhonesOf, sharedPhonesOf, partnersOnPhone, ownsPhone,
} = await import('../src/partners.ts');
const { feedbackByPhone } = await import('../src/feedbackBuckets.ts');
const { buildLeadClients } = await import('../shared/leadClients.js');

let passed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}${extra ? ` — ${extra}` : ''}`);
    process.exit(1);
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const AT = '2026-10-29T12:00:00.000Z';
const OLD = '2026-10-20T08:00:00.000Z';

const client = { id: 'c1', userId: 'ahmed', assignedTo: 'ahmed', name: 'عميل', phone: '01001234567', updatedAt: OLD };
const lead = { id: 'l1', salesId: 'ahmed', name: 'رقم', phone: '01001234567', status: 'viewed' };

// ===== إضافة شريك =====
const shared = withPartner(client, 'sara', AT);
check('إضافة شريك بتكتبه على السجل', same(partnerIdsOf(shared), ['sara']));
check('الإضافة بتحدّث updatedAt (المزامنة: الأحدث يفوز)', shared.updatedAt === AT);
check('السجل الأصلي ما اتغيرش (نسخة جديدة)', partnerIdsOf(client).length === 0 && client.updatedAt === OLD);
check('نفس الشريك مرتين ما يتكررش', withPartner(shared, 'sara', AT) === shared);
check('صاحب الرقم ما ينفعش يبقى شريك نفسه', withPartner(client, 'ahmed', AT) === client);
check('معرّف فاضي ما يضيفش حاجة', withPartner(client, '', AT) === client && withPartner(client, '  ', AT) === client);
check('أكتر من شريك', same(partnerIdsOf(withPartner(shared, 'omar', AT)), ['sara', 'omar']));
check('partnerIds فيها قيم بايظة بتتنضّف', same(partnerIdsOf({ partnerIds: ['sara', '', null, ' sara ', 'omar'] }), ['sara', 'omar']));

// ===== شيل شريك =====
const removed = withoutPartner(shared, 'sara', AT);
check('شيل الشريك', partnerIdsOf(removed).length === 0 && removed.updatedAt === AT);
check('شيل حد مش شريك ما يغيّرش السجل', withoutPartner(client, 'sara', AT) === client);

// ===== الملكية والشراكة =====
check('صاحب العميل (assignedTo/userId) هو المالك', isRecordOwner(client, 'ahmed'));
check('صاحب الرقم الموزّع (salesId) هو المالك', isRecordOwner(lead, 'ahmed'));
check('الشريك مش مالك', !isRecordOwner(shared, 'sara') && isPartnerOf(shared, 'sara'));
check('مستخدم من غير معرّف مش مالك ولا شريك', !isRecordOwner(client, '') && !isPartnerOf(shared, ''));

// ===== مين يدير الشركاء: صاحب الرقم بس =====
const records = [withPartner(client, 'sara', AT), withPartner(lead, 'sara', AT)];
check('صاحب الرقم يقدر يدير الشركاء', ownsPhone(records, '01001234567', 'ahmed'));
check('الشريك ما يقدرش يضيف/يشيل شركاء', !ownsPhone(records, '01001234567', 'sara'));
check('سيلز تالت ما يقدرش', !ownsPhone(records, '01001234567', 'omar'));
check('الشركاء على الرقم (عميل + رقم موزّع) من غير تكرار', same(partnersOnPhone(records, '0100 123 4567'), ['sara']));

// ===== نطاق البيانات =====
const other = { id: 'c2', userId: 'ahmed', assignedTo: 'ahmed', name: 'تاني', phone: '01119998888' };
const all = [...records, other];
check('خانة Shared Leads عند الشريك = الرقم المشترك بس', same([...partnerPhonesOf(all, 'sara')], ['01001234567']));
check('خانة Shared Leads عند صاحب الرقم فاضية (هو مش شريك)', partnerPhonesOf(all, 'ahmed').size === 0);
check('الكومنتات المشتركة: الرقم مشترك للطرفين', sharedPhonesOf(all, 'sara').has('01001234567') && sharedPhonesOf(all, 'ahmed').has('01001234567'));
check('رقم مش مشترك ما يتشاركش (باقي شغل صاحبه مقفول)', !sharedPhonesOf(all, 'sara').has('01119998888') && !sharedPhonesOf(all, 'ahmed').has('01119998888'));
check('سيلز مالوش علاقة ما يستلمش حاجة', sharedPhonesOf(all, 'omar').size === 0);

// ===== action الشريك بيحرّك حالة الرقم عند الطرفين =====
const feedbacks = [
  { id: 'f1', userId: 'ahmed', clientPhone: '01001234567', status: 'follow-up', feedback: 'كلمته', createdAt: '2026-10-29T09:00:00.000Z' },
  { id: 'f2', userId: 'sara', clientPhone: '01001234567', status: 'meeting', feedback: 'حددنا معاينة', createdAt: '2026-10-29T10:00:00.000Z' },
];
const snap = feedbackByPhone(feedbacks, [], [{ id: 'sara', name: 'سارة' }]).get('01001234567');
check('آخر action (من الشريك) هو حالة الرقم', snap?.status === 'meeting', snap?.status);
check('آخر كومنت ظاهر باسم كاتبه (الشريك)', snap?.note === 'حددنا معاينة' && snap?.noteBy === 'سارة');

// ===== الرقم الموزّع بيتحوّل لعميل والشراكة معاه =====
const converted = buildLeadClients({ leads: [withPartner(lead, 'sara', AT)], clients: [], at: AT });
check('الشراكة بتتنقل للعميل لما الرقم يتحوّل', converted.length === 1 && same(converted[0].partnerIds, ['sara']));
const plain = buildLeadClients({ leads: [lead], clients: [], at: AT });
check('رقم من غير شريك يتحوّل من غير partnerIds', plain.length === 1 && !('partnerIds' in plain[0]));

// ===== الواجهة والتحميل (App.tsx) =====
check('العميل بيتحمّل عند شريكه', /inMyScope\(c\.assignedTo\) \|\| isPartnerOf\(c, currentUser\.id\)/.test(app));
check('الرقم الموزّع بيتحمّل عند شريكه', /inMyScope\(l\.salesId\) \|\| isPartnerOf\(l, currentUser\.id\)/.test(app));
check('الكومنتات (بطاقات الفيدباك) المشتركة بتتحمّل للطرفين', /inMyScope\(f\.userId\) \|\| onSharedPhone\(f\.clientPhone\)/.test(app));
check('المكالمات المشتركة بتتحمّل للطرفين', /inMyScope\(l\.salesId\) \|\| onSharedPhone\(l\.clientPhone\)/.test(app));
check('بعد تسجيل مكالمة النطاق ما بيضيّعش المكالمات المشتركة', /setCallLogs\(getCallLogs\(\)\.filter\(inMyCallScope\)\)/.test(app));
check('الحفظ بيعدّل سجلات صاحب الرقم بس', /!isRecordOwner\(record, currentUser\.id\)\) return record/.test(app));
check('الحفظ بيستنى وصول التعديل للسيرفر', /clientsChanged \? pushKey\('crm_clients'\)/.test(app) && /results\.every\(Boolean\)/.test(app));
check('لو الحفظ ما وصلش للسيرفر المستخدم بيعرف', /if \(!ok\) \{\s*setInAppNotification/.test(app));
check('نافذة الإجراء فيها لوحة السيلز المشترك', /<PartnerPanel/.test(app) && /canManagePartners=\{ownsPhone\(myPartnerRecords, callClient\.phone, currentUser\.id\)\}/.test(app));
check('القائمة فيها السيلز المتاحين بس (مش أنا ولا الشركاء الحاليين)', /isAssignableSales\(u\) &&\s*u\.id !== currentUser\.id &&\s*!partnersOnPhone/.test(app));
check('زر «إضافة سيلز مشترك» + قائمة منسدلة', /إضافة سيلز مشترك/.test(panel) && /<select/.test(panel) && /aria-label="اختار السيلز الشريك"/.test(panel));
check('الزر مقفول لحد ما يتختار سيلز ووقت الحفظ (مفيش ضغطة مكررة)', /disabled=\{!pick \|\| busy\}/.test(panel));
check('الشريك يشوف الشركاء من غير زر شيل', /\{canManage && \(\s*<button/.test(panel));
check('خانة Shared Leads في لوحة الأرقام', /\{\s*id:\s*SHARED_ID,\s*label:\s*'Shared Leads',\s*cls:\s*'fs-shared'\s*\}/.test(app));
check('خانة Shared Leads في فلاتر صفحة الأرقام', /DELAY_ID, SHARED_ID, 'not-answered', 'follow-up'/.test(app) && /filter === SHARED_ID\) list = list\.filter\(\(row\) => row\.shared\)/.test(app));
check('الرئيسية وصفحة الأرقام بيستلموا أرقام الشراكة', /<DashboardView[^>]*sharedPhones=\{sharedWithMePhones\}/.test(app) && /sharedPhones=\{sharedWithMePhones\}\s*filter=\{leadsFilter\}/.test(app));
check('لون Shared Leads + تنسيق اللوحة', /\.fs-shared\s*\{/.test(css) && /\.eg-partners\s*\{/.test(css));

console.log(`\n${passed} checks passed — shared partners`);
