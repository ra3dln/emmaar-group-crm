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
        id: 'u-mohamed',
        username: 'mohamed',
        name: 'المطور',
        phone: '',
        role: 'sales',
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
    crm_assigned_leads: [],
    crm_reminders: [],
    crm_teams: [],
  },
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(db, null, 2), 'utf8');
console.log(`تم تجهيز بيانات الاختبار: ${target}`);