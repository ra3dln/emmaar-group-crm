// ===== بيانات تجريبية معزولة لاختبار الحماية على السيرفر المحلي ====
// تُنشئ ملف بيانات منفصلاً تماماً (data/e2e-auth-db.json) حتى لا تلمس بيانات الشركة:
//   admin / admin123      (كلمة المرور الافتراضية الضعيفة => إلزام تغيير)
//   ahmed / Ahmed1234     (سيلز، كلمة مرور نصية قديمة => تُرقّى عند أول دخول)
//   mohamed / Dev1234     (مطور، role: sales للمشاركة في توزيع الأرقام ورؤية قائمة السيلز)
// التشغيل:  node tests/seed-e2e-db.mjs

import fs from 'node:fs';
import path from 'node:path';

const target = process.env.CRM_DB_FILE ? path.resolve(process.env.CRM_DB_FILE) : 'data/e2e-auth-db.json';

const db = {
  version: 1,
  data: {
    crm_users: [
      {
        id: 'admin-001',
        username: 'admin',
        name: 'إدارة إعمار جروب',
        phone: '',
        role: 'admin',
        team: '',
        isActive: true,
        password: 'admin123',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'system',
      },
      {
        id: 'sales-9',
        username: 'ahmed',
        name: 'أحمد سيلز',
        phone: '01000000001',
        role: 'sales',
        team: 'فريق أ',
        isActive: true,
        password: 'Ahmed1234',
        createdAt: '2026-09-02T00:00:00.000Z',
        createdBy: 'system',
      },
      {
        id: 'sales-2',
        username: 'sara',
        name: 'سارة سيلز',
        phone: '01000000002',
        role: 'sales',
        team: 'فريق أ',
        isActive: true,
        password: 'Sara1234',
        createdAt: '2026-09-03T00:00:00.000Z',
        createdBy: 'system',
      },
      {
        id: 'u-mohamed',
        username: 'mohamed',
        name: 'mohamed',
        phone: '',
        role: 'admin',
        // حساب المطوّر: يظهر في المحادثة بلقب System Developer
        developer: true,
        team: '',
        isActive: true,
        password: 'Dev1234',
        createdAt: '2026-09-15T00:00:00.000Z',
        createdBy: 'system',
      },
    ],
    crm_clients: [
      {
        id: 'c1',
        userId: 'sales-9',
        name: 'عميل سري للتجربة',
        phone: '01000000009',
        status: 'new',
        stage: 'new',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    crm_properties: [],
    // رقم موزّع لكل مندوب على حدة — للتحقق أن كل حساب يرى أرقامه فقط
    crm_assigned_leads: [
      {
        id: 'lead-ahmed-1',
        name: 'رقم خاص بأحمد',
        phone: '01000000021',
        salesId: 'sales-9',
        status: 'new',
        createdAt: '2026-09-20T09:00:00.000Z',
      },
      {
        id: 'lead-mohamed-1',
        name: 'رقم خاص بمحمد',
        phone: '01000000022',
        salesId: 'u-mohamed',
        status: 'new',
        createdAt: '2026-09-20T09:05:00.000Z',
      },
    ],
    crm_reminders: [
      {
        id: 'rem-ahmed-1',
        userId: 'sales-9',
        clientId: 'c1',
        clientName: 'عميل سري للتجربة',
        clientPhone: '01000000009',
        dateTime: '2026-09-20T10:00:00.000Z',
        note: 'متابعة خاصة بأحمد',
        isCompleted: false,
        isDelayed: false,
        delayCount: 0,
        createdAt: '2026-09-20T09:00:00.000Z',
      },
    ],
    crm_daily_feedback: [
      {
        id: 'fb-ahmed-1',
        userId: 'sales-9',
        clientPhone: '01000000009',
        clientName: 'عميل سري للتجربة',
        date: '2026-09-20T09:30:00.000Z',
        feedback: 'فيدباك أحمد — لا يظهر لمحمد',
        callStatus: 'called',
        status: 'follow-up',
        createdAt: '2026-09-20T09:30:00.000Z',
      },
    ],
    crm_messages: [
      {
        id: 'msg-ahmed-1',
        fromId: 'admin-001',
        fromName: 'إدارة إعمار جروب',
        toId: 'sales-9',
        text: 'رسالة للإدارة مع أحمد فقط',
        createdAt: '2026-09-20T09:40:00.000Z',
      },
    ],
    crm_teams: [],
  },
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(db, null, 2), 'utf8');
console.log(`تم تجهيز بيانات الاختبار: ${target}`);