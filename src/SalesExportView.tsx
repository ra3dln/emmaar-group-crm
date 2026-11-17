import { useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { SYNC_EVENT } from './sync';
import { buildXlsxBook, downloadBlob } from './xlsx';
import { buildSalesExportRows, exportSheet, type ExportRow } from './salesExport';

const readList = (key: string): any[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const todayStamp = () => new Date().toISOString().slice(0, 10);
const safeFileName = (value: string) => String(value || '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'سيلز';
const NO_FORM = 'بدون فورم';

// تجميع الصفوف لكل سيلز (ورقة لكل سيلز)
const groupBySales = (rows: ExportRow[]) => {
  const map = new Map<string, { id: string; name: string; rows: ExportRow[] }>();
  for (const row of rows) {
    if (!map.has(row.salesId)) map.set(row.salesId, { id: row.salesId, name: row.sales, rows: [] });
    map.get(row.salesId)!.rows.push(row);
  }
  return [...map.values()];
};

// ===== تبويب «تصدير الأرقام»: شيت إكسل بكل أرقام السيلز والفيدباك =====
// فلتر بالفورم (عملاء كامبين معيّنة) + بحث + اختيار عملاء بعينهم يدوي.
export function SalesExportView() {
  // نفس المخزون الكامل اللي على جهاز الإدارة — ويتحدّث مع كل مزامنة
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener(SYNC_EVENT, refresh);
    return () => window.removeEventListener(SYNC_EVENT, refresh);
  }, []);
  const rows = useMemo(
    () =>
      buildSalesExportRows({
        users: readList('crm_users'),
        clients: readList('crm_clients'),
        leads: readList('crm_assigned_leads'),
        cards: readList('crm_daily_feedback'),
        logs: readList('crm_call_logs'),
      }),
    [version]
  );

  const [formFilter, setFormFilter] = useState('all');
  const [salesFilter, setSalesFilter] = useState('all');
  const [query, setQuery] = useState('');
  // العملاء المختارين يدوي (بالمفتاح) — فاضي = مفيش اختيار
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const formOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.form || NO_FORM, (counts.get(row.form || NO_FORM) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const salesOptions = useMemo(() => groupBySales(rows).map((g) => ({ id: g.id, name: g.name })), [rows]);

  const q = query.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      (formFilter === 'all' || (row.form || NO_FORM) === formFilter) &&
      (salesFilter === 'all' || row.salesId === salesFilter) &&
      (!q || `${row.name} ${row.phone} ${row.sales}`.toLowerCase().includes(q))
  );
  const perSales = groupBySales(visible);
  const pickedRows = rows.filter((row) => picked.has(row.key));
  const allVisiblePicked = visible.length > 0 && visible.every((row) => picked.has(row.key));

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleVisible = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const row of visible) {
        if (allVisiblePicked) next.delete(row.key);
        else next.add(row.key);
      }
      return next;
    });

  const filterLabel = formFilter === 'all' ? '' : ` — ${formFilter}`;
  // ملف فيه ورقة للكل + ورقة لكل سيلز
  const downloadBook = (list: ExportRow[], title: string, file: string) => {
    const groups = groupBySales(list);
    const sheets = groups.length === 1
      ? [exportSheet(groups[0].name, `${title} — ${todayStamp()}`, list)]
      : [
          exportSheet('الكل', `${title} — ${todayStamp()}`, list),
          ...groups.map((g) => exportSheet(g.name, `أرقام ${g.name}${filterLabel} — ${todayStamp()}`, g.rows)),
        ];
    downloadBlob(buildXlsxBook(sheets), `${safeFileName(file)}-${todayStamp()}.xlsx`);
  };

  const fieldClass = 'bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2.5 text-[var(--text-strong)] text-sm';

  return (
    <div className="space-y-3.5">
      <div className="panel p-3.5 flex flex-wrap gap-2.5 items-end">
        <label>
          <span className="block text-[11px] text-[var(--text-muted)] mb-1">الفورم (عملاء كامبين)</span>
          <select value={formFilter} onChange={(e) => setFormFilter(e.target.value)} className={fieldClass}>
            <option value="all" className="bg-gray-900">كل الفورمات ({rows.length})</option>
            {formOptions.map(([name, count]) => <option key={name} value={name} className="bg-gray-900">{name} ({count})</option>)}
          </select>
        </label>
        <label>
          <span className="block text-[11px] text-[var(--text-muted)] mb-1">السيلز</span>
          <select value={salesFilter} onChange={(e) => setSalesFilter(e.target.value)} className={fieldClass}>
            <option value="all" className="bg-gray-900">كل السيلز</option>
            {salesOptions.map((s) => <option key={s.id} value={s.id} className="bg-gray-900">{s.name}</option>)}
          </select>
        </label>
        <label className="flex-1 min-w-[160px]">
          <span className="block text-[11px] text-[var(--text-muted)] mb-1">بحث</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم أو رقم" className={`${fieldClass} w-full`} />
        </label>
        <button type="button" disabled={!visible.length} className="btn-primary disabled:opacity-50"
          onClick={() => downloadBook(visible, `أرقام${filterLabel}`, `أرقام${formFilter === 'all' ? '-كل-السيلز' : `-${formFilter}`}`)}>
          <Download className="w-4 h-4" /> تنزيل المعروض ({visible.length})
        </button>
        <button type="button" disabled={!pickedRows.length}
          onClick={() => downloadBook(pickedRows, 'عملاء مختارين', 'عملاء-مختارين')}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-4 py-2.5 rounded-[var(--r-md)] text-sm font-bold flex items-center gap-2">
          <Download className="w-4 h-4" /> تنزيل المختارين ({pickedRows.length})
        </button>
        {pickedRows.length > 0 && (
          <button type="button" onClick={() => setPicked(new Set())} className="text-xs text-[var(--text-muted)] underline">إلغاء الاختيار</button>
        )}
      </div>

      {perSales.length > 0 && (
        <div className="panel p-2 sm:p-3 divide-y divide-[var(--border)]">
          {perSales.map((group) => (
            <div key={group.id} className="flex items-center gap-3 px-2 py-2.5">
              <FileSpreadsheet className="w-5 h-5 shrink-0 text-[var(--text-muted)]" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[var(--text-strong)] truncate">{group.name}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{group.rows.length} رقم{filterLabel}</p>
              </div>
              <button type="button" onClick={() => downloadBook(group.rows, `أرقام ${group.name}${filterLabel}`, `أرقام-${group.name}`)}
                className="bg-[var(--tint-2)] hover:bg-[var(--tint-3)] text-[var(--text-strong)] px-4 py-2 rounded-[var(--r-md)] text-sm font-bold flex items-center gap-2">
                <Download className="w-4 h-4" /> تنزيل
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="panel p-2 sm:p-3 overflow-x-auto">
        {visible.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] p-2">مفيش أرقام بالفلتر ده.</p>
        ) : (
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-[var(--text-muted)] text-xs">
                <th className="py-2 px-2 w-8">
                  <input type="checkbox" checked={allVisiblePicked} onChange={toggleVisible} title="اختيار كل المعروض" />
                </th>
                <th className="text-right py-2 px-2">العميل</th>
                <th className="text-right py-2 px-2">الرقم</th>
                <th className="text-right py-2 px-2">السيلز</th>
                <th className="text-right py-2 px-2">الفورم</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.key} className="border-t border-[var(--border)] cursor-pointer" onClick={() => toggle(row.key)}>
                  <td className="py-2 px-2 text-center">
                    <input type="checkbox" checked={picked.has(row.key)} onChange={() => toggle(row.key)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="py-2 px-2 text-[var(--text-strong)]">{row.name}</td>
                  <td className="py-2 px-2 text-[var(--text)]" dir="ltr" style={{ textAlign: 'right' }}>{row.phone}</td>
                  <td className="py-2 px-2 text-[var(--text)]">{row.sales}</td>
                  <td className="py-2 px-2 text-[var(--text-muted)] text-xs">{row.form || NO_FORM}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-dim)]">
        الشيت فيه: اسم السيلز • اسم العميل • الرقم • الفيدباك (من الأقدم للأحدث: التاريخ — مين كتبه: الكومنت [الحالة]).
        لما الشيت فيه أكتر من سيلز: ورقة للكل + ورقة لكل سيلز.
      </p>
    </div>
  );
}
