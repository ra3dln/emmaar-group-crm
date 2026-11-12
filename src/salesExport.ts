// ===== شيت أرقام السيلز (تبويب «تصدير الأرقام» عند الإدارة) =====
// لكل سيلز: كل الأرقام اللي في عهدته (عملاؤه + أرقام موزّعة عليه لسه ما اتحوّلتش
// لعميل) — واسم العميل والرقم والفيدباك كامل (كل الكومنتات من الأقدم للأحدث).
// الكومنتات من كل المصادر: خط العميل + بطاقات الفيدباك اليومي + سجل المكالمات،
// ونفس الكومنت المكتوب في أكتر من مكان بيظهر مرة واحدة.
// الملف نقي (بلا واجهة) عشان يتختبر في tests/sales-export.mjs.

import {
  cleanCommentText,
  dedupeComments,
  isCallResultText,
  isCommentActivity,
  isSystemOnlyText,
} from '../shared/comments.js';
import { leadCommentActivity } from '../shared/leadClients.js';
import { formNameOf } from './campaignForms.ts';

const STATUS_LABELS: Record<string, string> = {
  'fresh-stage': 'Fresh',
  'follow-up': 'Follow Up',
  meeting: 'Meeting',
  'after-meeting': 'Following after Meeting',
  reschedule: 'Reschedule Meeting',
  cancellation: 'Cancellation',
  'no-answer': 'No Answer',
  'done-deal': 'Done Deal',
  reservation: 'Reservation',
};

// حد إكسل لنص الخانة الواحدة
export const EXCEL_CELL_LIMIT = 32767;

const digitsOf = (value: any): string =>
  String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');

const keepText = (text: string) => !!text && (!isSystemOnlyText(text) || isCallResultText(text));

const stamp = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export type ExportRow = { key: string; sales: string; salesId: string; name: string; phone: string; form: string; feedback: string };

type Comment = { id: string; at: string; by: string; text: string; status?: string };

// كل كومنتات رقم واحد (من الأقدم للأحدث) في نص واحد — سطر لكل كومنت
export const feedbackTextOf = (
  phone: string,
  client: any,
  cards: any[],
  logs: any[],
  nameOf: (id: any) => string
): string => {
  const key = digitsOf(phone);
  const list: Comment[] = [];
  for (const a of Array.isArray(client?.activities) ? client.activities : []) {
    if (!isCommentActivity(a)) continue;
    const text = cleanCommentText(a?.text);
    if (keepText(text)) list.push({ id: String(a?.id || ''), at: String(a?.at || ''), by: String(a?.by || nameOf(a?.authorId)), text, status: a?.status });
  }
  for (const card of cards) {
    if (digitsOf(card?.clientPhone) !== key) continue;
    const text = cleanCommentText(card?.feedback);
    if (keepText(text)) list.push({ id: String(card?.id || ''), at: String(card?.createdAt || card?.date || ''), by: nameOf(card?.userId), text, status: card?.status });
  }
  for (const log of logs) {
    if (digitsOf(log?.clientPhone) !== key) continue;
    const text = cleanCommentText(log?.comment);
    if (keepText(text)) list.push({ id: String(log?.id || ''), at: String(log?.createdAt || ''), by: String(log?.salesName || nameOf(log?.salesId)), text });
  }
  const unique = dedupeComments(list.sort((a, b) => String(a.at).localeCompare(String(b.at)))) as Comment[];
  const text = unique
    .map((c) => {
      const label = c.status && STATUS_LABELS[c.status] ? ` [${STATUS_LABELS[c.status]}]` : '';
      return `${stamp(c.at)} — ${c.by || 'غير معروف'}: ${c.text}${label}`;
    })
    .join('\n');
  return text.length > EXCEL_CELL_LIMIT ? `${text.slice(0, EXCEL_CELL_LIMIT - 20)}\n… (الباقي اتقص)` : text;
};

// صفوف كل الأرقام في عهدة كل سيلز
export const buildSalesExportRows = ({
  users = [],
  clients = [],
  leads = [],
  cards = [],
  logs = [],
}: {
  users?: any[];
  clients?: any[];
  leads?: any[];
  cards?: any[];
  logs?: any[];
}): ExportRow[] => {
  const nameOf = (id: any) => String(users.find((u) => String(u?.id) === String(id || ''))?.name || '');
  const rows: ExportRow[] = [];
  const clientPhones = new Set<string>();
  for (const client of clients) {
    const owner = String(client?.userId || client?.assignedTo || '').trim();
    const key = digitsOf(client?.phone);
    if (key) clientPhones.add(key);
    if (!owner || !nameOf(owner)) continue;
    const extra = (Array.isArray(client?.phones) ? client.phones : []).map((p: any) => String(p || '').trim()).filter(Boolean);
    rows.push({
      key: `c:${client?.id}`,
      sales: nameOf(owner),
      salesId: owner,
      name: String(client?.name || '').trim() || 'بدون اسم',
      phone: [String(client?.phone || ''), ...extra].join(' / '),
      form: formNameOf(client),
      feedback: feedbackTextOf(client?.phone, client, cards, logs, nameOf),
    });
  }
  // أرقام موزّعة لسه ما اتحوّلتش لعميل (المحوّلة موجودة فوق كعميل)
  for (const lead of leads) {
    const owner = String(lead?.salesId || '').trim();
    const key = digitsOf(lead?.phone);
    if (!owner || !nameOf(owner) || !key || clientPhones.has(key) || lead?.status === 'closed') continue;
    clientPhones.add(key);
    const extra = (Array.isArray(lead?.phones) ? lead.phones : []).map((p: any) => String(p || '').trim()).filter(Boolean);
    // كومنت الإدارة على الرقم (لسه ما اتحوّلش لعميل) جزء من الفيدباك برضه
    const adminComment = leadCommentActivity(lead);
    rows.push({
      key: `l:${lead?.id}`,
      sales: nameOf(owner),
      salesId: owner,
      name: String(lead?.name || '').trim() || 'بدون اسم',
      phone: [String(lead?.phone || ''), ...extra].join(' / '),
      form: formNameOf(lead),
      feedback: feedbackTextOf(lead?.phone, adminComment ? { activities: [adminComment] } : null, cards, logs, nameOf),
    });
  }
  return rows.sort((a, b) => a.sales.localeCompare(b.sales, 'ar') || a.name.localeCompare(b.name, 'ar'));
};

export const EXPORT_HEADER = ['اسم السيلز', 'اسم العميل', 'الرقم', 'الفيدباك'];

// ورقة إكسل جاهزة لـ buildXlsxBook
export const exportSheet = (sheetName: string, title: string, rows: ExportRow[]) => ({
  sheetName,
  rows: [[title], EXPORT_HEADER, ...rows.map((r) => [r.sales, r.name, r.phone, r.feedback])],
  titleRows: [1],
  headerRows: [2],
  wrapColumns: [3],
  freeze: { rows: 2 },
  columnWidths: [18, 24, 18, 90],
  merges: ['A1:D1'],
});
