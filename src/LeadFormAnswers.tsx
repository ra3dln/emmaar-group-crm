// ===== «كلام العميل في الفورم» في تفاصيل العميل (زرار العين) =====
// الإجابات بيكتبها السيرفر وقت السحب (crm_lead_answers) — هنا بنقراها ونعرضها.
import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { SYNC_EVENT } from './sync';
import { LEAD_ANSWERS_KEY, answersByPhone, type LeadAnswerEntry } from '../shared/leadAnswers.js';
import { repeatPhoneKey } from '../shared/leadRepeats.js';

const readAnswers = (): any[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEAD_ANSWERS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const useLeadAnswers = (): Map<string, LeadAnswerEntry[]> => {
  const [map, setMap] = useState(() => answersByPhone(readAnswers()));
  useEffect(() => {
    const refresh = () => setMap(answersByPhone(readAnswers()));
    window.addEventListener(SYNC_EVENT, refresh);
    return () => window.removeEventListener(SYNC_EVENT, refresh);
  }, []);
  return map;
};

const stamp = (value: string) => {
  const at = Date.parse(String(value || ''));
  if (!Number.isFinite(at)) return '';
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function LeadFormAnswers({ phones = [] }: { phones?: any[] }) {
  const map = useLeadAnswers();
  const seen = new Set<string>();
  const entries: LeadAnswerEntry[] = [];
  for (const phone of phones) {
    for (const entry of map.get(repeatPhoneKey(phone)) || []) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  if (!entries.length) return null;
  return (
    <div className="mt-4 lead-form-answers">
      <h3 className="text-sm font-bold text-[var(--text-strong)] mb-2 flex items-center gap-2">
        <ClipboardList className="w-4 h-4" /> كلام العميل في الفورم
      </h3>
      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={entry.id} className="bg-[var(--tint-1)] rounded-[var(--r-md)] px-3 py-2.5">
            <p className="text-[11px] text-[var(--text-dim)] mb-1.5">
              <span translate="no">{entry.formName || 'فورم'}</span>
              {entry.campaignAt && <span dir="ltr"> • {stamp(entry.campaignAt)}</span>}
            </p>
            <dl className="space-y-1">
              {entry.answers.map((item, index) => (
                <div key={`${entry.id}-${index}`} className="text-xs leading-relaxed">
                  <dt className="inline font-bold text-[var(--text-muted)]">{item.q}: </dt>
                  <dd className="inline text-[var(--text-strong)] break-words">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
