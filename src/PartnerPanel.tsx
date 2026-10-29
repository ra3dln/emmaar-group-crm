// ===== «السيلز المشترك» جوّه نافذة الإجراء =====
// صاحب الرقم يختار سيلز من القائمة ويضيفه شريك (أو يشيله)، والشريك يشوف
// الشركاء بس من غير ما يعدّل. المنطق نفسه في src/partners.ts.
import { useState } from 'react';
import { UserPlus, Users, X } from 'lucide-react';
import type { User } from './types';

type Props = {
  partners: User[];
  options: User[];
  canManage: boolean;
  // true = وصل للسيرفر
  onAdd: (id: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
};

export function PartnerPanel({ partners, options, canManage, onAdd, onRemove }: Props) {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  if (!canManage && partners.length === 0) return null;

  // ضغطة واحدة لحد ما الحفظ يخلص (من غير تكرار)، والاختيار بيفضل لو الحفظ فشل
  const run = async (action: () => Promise<boolean>, afterSuccess?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      if (await action()) afterSuccess?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="eg-partners" aria-label="السيلز المشترك">
      <div className="eg-partners-head">
        <Users className="w-4 h-4" aria-hidden="true" />
        <span>السيلز المشترك</span>
      </div>
      {partners.length > 0 ? (
        <div className="eg-partners-list">
          {partners.map((partner) => (
            <span key={partner.id} className="eg-partner-chip">
              {partner.name}
              {canManage && (
                <button
                  type="button"
                  aria-label={`شيل ${partner.name} من السيلز المشترك`}
                  title={`شيل ${partner.name}`}
                  disabled={busy}
                  onClick={() => void run(() => onRemove(partner.id))}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="eg-partners-empty">مفيش سيلز مشترك على العميل ده.</p>
      )}
      {canManage &&
        (options.length > 0 ? (
          <div className="eg-partners-add">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              aria-label="اختار السيلز الشريك"
              disabled={busy}
            >
              <option value="">اختار السيلز…</option>
              {options.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="eg-partners-btn"
              disabled={!pick || busy}
              onClick={() => void run(() => onAdd(pick), () => setPick(''))}
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              {busy ? 'بيتحفظ…' : 'إضافة سيلز مشترك'}
            </button>
          </div>
        ) : (
          <p className="eg-partners-empty">مفيش سيلز تاني متاح للإضافة.</p>
        ))}
    </section>
  );
}
