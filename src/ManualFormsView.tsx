import { useEffect, useState } from 'react';
import { FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import { pushKey, SYNC_EVENT } from './sync';
import { buildPreview, readSheetTable, type ImportPreview } from './leadImport';
import { ACTIVE_FORMS_EVENT, formNameOf } from './campaignForms';
import { removeExtraFormName, saveExtraFormName } from './leadForms';
import {
  MANUAL_FORM_LABEL,
  MANUAL_FORMS_KEY,
  buildManualForm,
  formNameTaken,
  parseManualForms,
  planManualFormDeletion,
  type ManualForm,
} from './manualForms';
import { isDeveloperAccount } from '../shared/roles.js';

const readList = (key: string): any[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// قائمة الفورمات اليدوية — بتتحدّث لما جهاز تاني يضيف أو يحذف فورم
export const useManualForms = (): ManualForm[] => {
  const read = () => parseManualForms(localStorage.getItem(MANUAL_FORMS_KEY));
  const [forms, setForms] = useState<ManualForm[]>(read);
  useEffect(() => {
    const refresh = () => setForms(read());
    window.addEventListener(SYNC_EVENT, refresh);
    window.addEventListener(ACTIVE_FORMS_EVENT, refresh);
    return () => {
      window.removeEventListener(SYNC_EVENT, refresh);
      window.removeEventListener(ACTIVE_FORMS_EVENT, refresh);
    };
  }, []);
  return forms;
};

export const useManualFormNames = (): string[] => useManualForms().map((form) => form.name);

const fieldClass =
  'w-full bg-[var(--tint-1)] border border-[var(--border)] rounded-[var(--r-md)] px-4 py-3 text-[var(--text-strong)]';

// ===== تبويب «إضافة فورم» =====
export function ManualFormsView({ currentUser, activeForms = [], onChanged }: any) {
  const forms = useManualForms();
  const canDelete = isDeveloperAccount(currentUser);
  const [formName, setFormName] = useState('');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  // اتحفظ على الجهاز وماوصلش للسيرفر — نعيد الرفع بدل ما نكرر الفورم
  const [pendingPush, setPendingPush] = useState(false);
  const [confirmForm, setConfirmForm] = useState<ManualForm | null>(null);

  const existingPhones = () => [
    ...readList('crm_assigned_leads').map((lead) => lead.phone),
    ...readList('crm_clients').flatMap((client) => [client.phone, ...(client.phones || [])]),
  ].filter(Boolean);

  const reset = () => {
    setFormName('');
    setFileName('');
    setTable([]);
    setPreview(null);
  };

  const readFile = async (file: File) => {
    setError('');
    setNotice('');
    if (/\.xls$/i.test(file.name)) {
      setError('صيغة xls القديمة مش مدعومة — افتح الملف في إكسل واحفظه xlsx.');
      return;
    }
    try {
      const rows = await readSheetTable(file);
      const built = rows.length ? buildPreview(rows, existingPhones()) : null;
      if (!built || !built.rows.length) {
        setError('الملف فارغ أو مش مقروء');
        return;
      }
      setTable(rows);
      setPreview(built);
      setFileName(file.name);
    } catch (e: any) {
      setError(e?.message || 'تعذّر قراءة الملف — تأكد إنه إكسل أو CSV');
    }
  };

  const remap = (next: ImportPreview['mapping']) => setPreview(buildPreview(table, existingPhones(), next));

  // العناوين في القوائم: اسم العمود، أو «العمود ٣» لو الشيت من غير عناوين
  const columnWidth = Math.max(preview?.header?.length || 0, ...table.map((row) => row.length), 0);
  const columns = Array.from({ length: columnWidth }, (_, i) => preview?.header?.[i] || `العمود ${i + 1}`);

  const pushAdded = async () => {
    const [leadsOk, formsOk] = await Promise.all([pushKey('crm_assigned_leads'), pushKey(MANUAL_FORMS_KEY)]);
    return leadsOk && formsOk;
  };

  const handleSave = async () => {
    if (!preview || saving) return;
    setError('');
    setNotice('');
    const name = formName.trim();
    if (!name) {
      setError('اكتب اسم الفورم');
      return;
    }
    const usedNames = [
      ...activeForms,
      ...forms.map((form: ManualForm) => form.name),
      ...readList('crm_assigned_leads').map((lead) => formNameOf(lead)).filter(Boolean),
      ...readList('crm_clients').map((client) => formNameOf(client)).filter(Boolean),
    ];
    if (formNameTaken(name, usedNames)) {
      setError('في فورم بالاسم ده بالفعل — اختار اسم تاني عشان الأرقام ما تتخلطش.');
      return;
    }
    const { form, leads } = buildManualForm({
      name,
      fileName,
      rows: preview.rows,
      adminId: String(currentUser?.id || ''),
      adminName: String(currentUser?.name || ''),
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
    if (!leads.length) {
      setError('مفيش أرقام جديدة في الملف — كلها مكررة أو غير صالحة.');
      return;
    }
    setSaving(true);
    // الفورم الأول: الأرقام باسم فورم غير مسجّل بتتخفي من القوائم
    if (!(await saveExtraFormName(name))) {
      setSaving(false);
      setError('تعذّر حفظ الفورم — ما اتضافش أي رقم. اتأكد من الاتصال وجرّب تاني.');
      return;
    }
    localStorage.setItem('crm_assigned_leads', JSON.stringify([...leads, ...readList('crm_assigned_leads')]));
    localStorage.setItem(MANUAL_FORMS_KEY, JSON.stringify([form, ...readList(MANUAL_FORMS_KEY)]));
    window.dispatchEvent(new Event(ACTIVE_FORMS_EVENT));
    const ok = await pushAdded();
    setSaving(false);
    onChanged?.();
    if (!ok) {
      setPendingPush(true);
      setError('الفورم اتسجّل على الجهاز ده بس ماوصلش للسيرفر — اضغط «إعادة الرفع».');
    } else {
      setNotice(`تمت إضافة «${name}» — ${leads.length} رقم في «توزيع الأرقام».`);
    }
    reset();
  };

  const retryPush = async () => {
    setSaving(true);
    const ok = await pushAdded();
    setSaving(false);
    if (ok) {
      setPendingPush(false);
      setError('');
      setNotice('الفورم وصل للسيرفر.');
    }
  };

  const deletion = confirmForm
    ? planManualFormDeletion(confirmForm.name, readList('crm_assigned_leads'), readList('crm_clients'))
    : null;

  const handleDelete = async () => {
    if (!confirmForm || !deletion || saving || !canDelete) return;
    setSaving(true);
    setError('');
    setNotice('');
    const leadIds = new Set(deletion.leadIds);
    const clientIds = new Set(deletion.clientIds);
    localStorage.setItem('crm_assigned_leads', JSON.stringify(readList('crm_assigned_leads').filter((l) => !leadIds.has(String(l.id)))));
    localStorage.setItem('crm_clients', JSON.stringify(readList('crm_clients').filter((c) => !clientIds.has(String(c.id)))));
    localStorage.setItem(MANUAL_FORMS_KEY, JSON.stringify(readList(MANUAL_FORMS_KEY).filter((f) => String(f.id) !== String(confirmForm.id))));
    const rules = readList('crm_lead_auto_assign');
    const nextRules = rules.filter((rule) => String(rule.formName || '') !== confirmForm.name);
    if (nextRules.length !== rules.length) localStorage.setItem('crm_lead_auto_assign', JSON.stringify(nextRules));
    window.dispatchEvent(new Event(ACTIVE_FORMS_EVENT));
    // pushKey بتسجّل شاهد الحذف لوحدها، فالسجلات ما ترجعش من جهاز قديم
    const results = await Promise.all([
      pushKey('crm_assigned_leads'),
      pushKey('crm_clients'),
      pushKey(MANUAL_FORMS_KEY),
      nextRules.length !== rules.length ? pushKey('crm_lead_auto_assign') : Promise.resolve(true),
      removeExtraFormName(confirmForm.name),
    ]);
    setSaving(false);
    onChanged?.();
    if (results.every(Boolean)) setNotice(`اتحذف «${confirmForm.name}» — ${deletion.leadIds.length} رقم.`);
    else setError('اتحذف على الجهاز ده بس جزء ماوصلش للسيرفر — تأكد من الاتصال وافتح الصفحة تاني.');
    setConfirmForm(null);
  };

  return (
    <div className="space-y-4">
      <div className="page-intro"><div><h2>إضافة فورم</h2><p>اكتب اسم الفورم وارفع شيت فيه الاسم والرقم، والأرقام هتنزل في «توزيع الأرقام».</p></div></div>

      {notice && <p className="text-sm font-bold text-emerald-400">{notice}</p>}
      {error && (
        <p className="text-sm text-red-400">
          {error}{' '}
          {pendingPush && (
            <button type="button" disabled={saving} onClick={() => void retryPush()} className="underline font-bold">إعادة الرفع</button>
          )}
        </p>
      )}

      <div className="panel p-4 sm:p-5 space-y-4">
        <label className="block">
          <span className="block text-xs text-[var(--text-muted)] mb-1.5 font-bold">اسم الفورم</span>
          <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: عملاء معرض أكتوبر" className={fieldClass} />
        </label>

        <div>
          <span className="block text-xs text-[var(--text-muted)] mb-1.5 font-bold">الشيت</span>
          <label className="inline-flex items-center gap-2 cursor-pointer bg-[var(--tint-2)] hover:bg-[var(--tint-3)] text-[var(--text-strong)] px-4 py-2.5 rounded-[var(--r-md)] text-sm font-bold">
            <Upload className="w-4 h-4" /> {fileName ? 'تغيير الملف' : 'اختر الملف'}
            <input type="file" accept=".xlsx,.xlsm,.csv,.txt,text/csv" className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file);
                e.target.value = '';
              }} />
          </label>
          {fileName && <span className="text-xs text-[var(--text-muted)] mr-3" dir="ltr">{fileName}</span>}
          <p className="text-xs text-[var(--text-dim)] mt-1.5">Excel (xlsx) أو CSV — والأرقام بأي صيغة (+20 أو 010 أو ٠١٠) بتتظبط لوحدها.</p>
        </div>

        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[
                { label: 'صفوف الشيت', value: preview.total, cls: 'text-[var(--text-strong)]' },
                { label: 'أرقام هتتضاف', value: preview.fresh, cls: 'text-emerald-400' },
                { label: 'مكررة (بتتجاهل)', value: preview.duplicates, cls: 'text-amber-400' },
                { label: 'غير صالحة', value: preview.invalid, cls: 'text-red-400' },
              ].map((item) => (
                <div key={item.label} className="bg-[var(--tint-1)] rounded-[var(--r-md)] p-2.5">
                  <p className={`text-lg font-extrabold ${item.cls}`}>{item.value}</p>
                  <p className="text-[10.5px] text-[var(--text-muted)]">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className="block text-xs text-[var(--text-muted)] mb-1 font-bold">عمود الاسم</span>
                <select value={preview.mapping.name || ''} onChange={(e) => remap({ ...preview.mapping, name: e.target.value || undefined })} className={fieldClass}>
                  <option value="" className="bg-gray-900">— اختار —</option>
                  {columns.map((label) => <option key={label} value={label} className="bg-gray-900">{label}</option>)}
                </select>
              </label>
              <label>
                <span className="block text-xs text-[var(--text-muted)] mb-1 font-bold">عمود الرقم</span>
                <select value={preview.mapping.phone || ''} onChange={(e) => remap({ ...preview.mapping, phone: e.target.value || undefined })} className={fieldClass}>
                  <option value="" className="bg-gray-900">— اختار —</option>
                  {columns.map((label) => <option key={label} value={label} className="bg-gray-900">{label}</option>)}
                </select>
              </label>
            </div>

            <p className="text-xs text-[var(--text-muted)]">راجع أول الصفوف قبل الإضافة — لو عمود غلط غيّره من فوق.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-[var(--text-muted)] text-xs">
                    <th className="text-right py-2 px-2">الاسم</th>
                    <th className="text-right py-2 px-2">الرقم</th>
                    <th className="py-2 px-2">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 15).map((row, index) => (
                    <tr key={index} className="border-t border-[var(--border)]">
                      <td className="py-2 px-2 text-[var(--text-strong)]">{row.name || '—'}</td>
                      <td className="py-2 px-2 text-[var(--text)]" dir="ltr" style={{ textAlign: 'right' }}>{row.phone || '—'}</td>
                      <td className={`py-2 px-2 text-center text-xs font-bold ${row.invalid ? 'text-red-400' : row.duplicate ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {row.invalid ? 'غير صالح' : row.duplicate ? 'مكرر' : 'جديد'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button type="button" disabled={saving || !preview.fresh || !formName.trim()} onClick={() => void handleSave()}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'جاري الإضافة…' : `إضافة الفورم (${preview.fresh} رقم)`}
            </button>
          </div>
        )}
      </div>

      <div className="panel p-4 sm:p-5">
        <h3 className="font-bold text-[var(--text-strong)] mb-3">الفورمات المضافة يدوي ({forms.length})</h3>
        {forms.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">لسه مفيش فورمات مضافة يدوي.</p>
        ) : (
          <div className="space-y-2">
            {forms.map((form: ManualForm) => (
              <div key={form.id} className="bg-[var(--tint-1)] rounded-[var(--r-md)] px-3 py-2.5 flex items-center gap-3">
                <FileSpreadsheet className="w-5 h-5 shrink-0 text-[var(--text-muted)]" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[var(--text-strong)] truncate">{form.name} <span className="text-[11px] font-normal text-[var(--brand)]">({MANUAL_FORM_LABEL})</span></p>
                  <p className="text-[11px] text-[var(--text-muted)]">{form.count} رقم • {form.createdBy} • <span dir="ltr">{String(form.createdAt).slice(0, 10)}</span></p>
                </div>
                {canDelete && (
                  <button type="button" title="حذف الفورم" onClick={() => setConfirmForm(form)} className="p-2 text-[var(--text-dim)] hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmForm && deletion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => !saving && setConfirmForm(null)}>
          <div className="panel p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--text-strong)] mb-2">حذف «{confirmForm.name}»؟</h3>
            <p className="text-sm text-[var(--text)]">
              هيتشال {deletion.leadIds.length} رقم من التوزيع و{deletion.clientIds.length} عميل، والحذف ما يترجعش.
            </p>
            {(deletion.assigned > 0 || deletion.worked > 0) && (
              <p className="text-sm text-amber-400 mt-2">
                {deletion.assigned} رقم موزّع على السيلز، و{deletion.worked} عميل عليهم كومنتات هتتشال معاهم.
              </p>
            )}
            <div className="flex gap-2 mt-5">
              <button type="button" disabled={saving} onClick={() => void handleDelete()} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2.5 rounded-[var(--r-md)] font-bold disabled:opacity-50">
                {saving ? 'جاري الحذف…' : 'حذف نهائي'}
              </button>
              <button type="button" disabled={saving} onClick={() => setConfirmForm(null)} className="flex-1 bg-[var(--tint-2)] text-[var(--text-strong)] py-2.5 rounded-[var(--r-md)] font-bold">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
