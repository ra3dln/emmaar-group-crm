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

// ===== تبويب «تصدير الأرقام»: شيت إكسل بكل أرقام السيلز والفيدباك =====
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
  const perSales = useMemo(() => {
    const map = new Map<string, { id: string; name: string; rows: ExportRow[] }>();
    for (const row of rows) {
      if (!map.has(row.salesId)) map.set(row.salesId, { id: row.salesId, name: row.sales, rows: [] });
      map.get(row.salesId)!.rows.push(row);
    }
    return [...map.values()];
  }, [rows]);

  const downloadOne = (group: { name: string; rows: ExportRow[] }) => {
    const blob = buildXlsxBook([exportSheet(group.name, `أرقام ${group.name} — ${todayStamp()}`, group.rows)]);
    downloadBlob(blob, `أرقام-${safeFileName(group.name)}-${todayStamp()}.xlsx`);
  };

  // الكل: أول ورقة فيها كل السيلز، وبعدها ورقة لكل سيلز
  const downloadAll = () => {
    const blob = buildXlsxBook([
      exportSheet('كل السيلز', `أرقام كل السيلز — ${todayStamp()}`, rows),
      ...perSales.map((group) => exportSheet(group.name, `أرقام ${group.name} — ${todayStamp()}`, group.rows)),
    ]);
    downloadBlob(blob, `أرقام-كل-السيلز-${todayStamp()}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="page-intro">
          <div>
            <h2>تصدير الأرقام</h2>
            <p>شيت إكسل فيه اسم السيلز واسم العميل والرقم والفيدباك كامل — لسيلز واحد أو للكل مرة واحدة.</p>
          </div>
        </div>
        <button type="button" onClick={downloadAll} disabled={!rows.length} className="btn-primary disabled:opacity-50">
          <Download className="w-4 h-4" /> تنزيل الكل ({rows.length} رقم)
        </button>
      </div>

      {perSales.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] panel p-4">مفيش أرقام متوزّعة على سيلز لسه.</p>
      ) : (
        <div className="panel p-2 sm:p-3 divide-y divide-[var(--border)]">
          {perSales.map((group) => (
            <div key={group.id} className="flex items-center gap-3 px-2 py-3">
              <FileSpreadsheet className="w-5 h-5 shrink-0 text-[var(--text-muted)]" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[var(--text-strong)] truncate">{group.name}</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {group.rows.length} رقم • {group.rows.filter((r) => r.feedback).length} عليهم فيدباك
                </p>
              </div>
              <button type="button" onClick={() => downloadOne(group)}
                className="bg-[var(--tint-2)] hover:bg-[var(--tint-3)] text-[var(--text-strong)] px-4 py-2 rounded-[var(--r-md)] text-sm font-bold flex items-center gap-2">
                <Download className="w-4 h-4" /> تنزيل
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-dim)]">
        الفيدباك من الأقدم للأحدث: التاريخ والوقت — مين كتبه: الكومنت [الحالة]. الشيت «كل السيلز» فيه ورقة للكل وورقة لكل سيلز.
      </p>
    </div>
  );
}
