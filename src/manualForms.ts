// ===== الفورمات المضافة يدوي (تبويب «إضافة فورم» عند الإدارة) =====
// المدير بيكتب اسم الفورم ويرفع شيت فيه الاسم والرقم، فالأرقام تنزل في «توزيع الأرقام»
// غير موزّعة زي أي فورم تاني. القائمة نفسها بتتزامن بين الأجهزة (crm_manual_forms)
// عشان اللافتة «فورم مضافة يدوي» والحذف يبقوا واحد عند كل الإدارة.
// الملف نقي (بلا واجهة) عشان يتختبر في tests/manual-forms.mjs.

import { formNameOf } from './campaignForms.ts';
import { leadClientIdFor } from '../shared/leadClients.js';

export const MANUAL_FORMS_KEY = 'crm_manual_forms';
export const MANUAL_FORM_LABEL = 'فورم مضافة يدوي';

export type ManualForm = {
  id: string;
  name: string;
  fileName: string;
  count: number;
  createdAt: string;
  createdBy: string;
};

export const parseManualForms = (raw: string | null | undefined): ManualForm[] => {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id && item.name) : [];
  } catch {
    return [];
  }
};

// اسم الفورم في القوائم + اللافتة لو كان مضاف يدوي
export const withManualTag = (name: string, manualNames: string[]): string =>
  manualNames.includes(String(name || '').trim()) ? `${name} (${MANUAL_FORM_LABEL})` : name;

// الاسم لازم يكون جديد: فورمين بنفس الاسم أرقامهم بتتخلط في «توزيع الأرقام»
export const formNameTaken = (name: string, existing: string[]): boolean => {
  const clean = String(name || '').trim().toLowerCase();
  return existing.some((item) => String(item || '').trim().toLowerCase() === clean);
};

type SheetRow = { name: string; phone: string; duplicate: boolean; invalid: boolean };

// سجل الفورم + رقم غير موزّع لكل سطر سليم وجديد في الشيت
export const buildManualForm = ({
  name,
  fileName,
  rows,
  adminId,
  adminName,
  now,
  newId,
}: {
  name: string;
  fileName: string;
  rows: SheetRow[];
  adminId: string;
  adminName: string;
  now: string;
  newId: () => string;
}) => {
  const formName = String(name || '').trim();
  const leads = rows
    .filter((row) => !row.invalid && !row.duplicate && row.phone)
    .map((row) => ({
      id: newId(),
      adminId,
      salesId: '',
      name: String(row.name || '').trim() || 'بدون اسم',
      phone: row.phone,
      description: `${MANUAL_FORM_LABEL} — ${fileName}`,
      status: 'new' as const,
      createdAt: now,
      campaignAt: now,
      formName,
    }));
  const form: ManualForm = { id: newId(), name: formName, fileName, count: leads.length, createdAt: now, createdBy: adminName };
  return { form, leads };
};

// اللي هيتشال مع الفورم: أرقامه + العميل التلقائي لكل رقم (نفس قاعدة حذف رقم من التوزيع:
// العميل اللي معرّفه مشتق من الرقم بس — عميل اتسجّل بنفسه ما بيتمسش)
export const planManualFormDeletion = (formName: string, leads: any[] = [], clients: any[] = []) => {
  const name = String(formName || '').trim();
  const formLeads = (leads || []).filter((lead) => formNameOf(lead).trim() === name);
  const clientIds = new Set(formLeads.map((lead) => leadClientIdFor(lead.phone)).filter(Boolean).map(String));
  const formClients = (clients || []).filter((client) => clientIds.has(String(client?.id)));
  return {
    leadIds: formLeads.map((lead) => String(lead.id)),
    clientIds: formClients.map((client) => String(client.id)),
    assigned: formLeads.filter((lead) => String(lead.salesId || '').trim()).length,
    // عملاء عليهم شغل (كومنتات/مكالمات) — لازم المدير يعرف قبل ما يأكد
    worked: formClients.filter((client) =>
      (Array.isArray(client.activities) ? client.activities : []).some((a: any) =>
        ['feedback', 'comment', 'note'].includes(String(a?.type || ''))
      )
    ).length,
  };
};
