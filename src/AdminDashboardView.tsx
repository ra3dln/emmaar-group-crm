import { useEffect, useMemo, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { SYNC_EVENT } from './sync';
import { buildWorkNumbers, coldPhonesOf, feedbackByPhone } from './feedbackBuckets';

const readList = (key: string): any[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// الكروت بالترتيب — كل كارت: اسمه + إزاي يتعدّ رقم فيه
type Card = { id: string; label: string; match: (n: any) => boolean };

// ===== تبويب «داشبورد» للإدارة =====
// عدد الأرقام في كل خانة عند كل السيلز (أو سيلز واحد / فريق قائد)، ونسبتها من الكل.
export function AdminDashboardView({ currentUser, users = [] }: any) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener(SYNC_EVENT, refresh);
    return () => window.removeEventListener(SYNC_EVENT, refresh);
  }, []);
  const [salesFilter, setSalesFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('none');

  const data = useMemo(() => {
    const allUsers = readList('crm_users');
    const clients = readList('crm_clients');
    const leads = readList('crm_assigned_leads');
    const logs = readList('crm_call_logs');
    const snapshots = feedbackByPhone(readList('crm_daily_feedback'), logs, allUsers);
    const leadById = new Map(leads.map((l: any) => [String(l.id), l]));
    const numbers = buildWorkNumbers(clients, leads, snapshots, { includeUnassigned: true }).map((n: any) => {
      const lead = n.leadId ? leadById.get(String(n.leadId)) : null;
      return { ...n, ownerId: String(n.client?.userId || n.client?.assignedTo || lead?.salesId || '') };
    });
    return { numbers, coldPhones: coldPhonesOf(logs) };
  }, [version]);

  // نطاق الحساب: الإدارة الكل، وقائد الفريق فريقه (users = نطاقه)
  const scope = new Set((users || []).map((u: any) => String(u.id)));
  const salesUsers = (users || []).filter((u: any) => ['sales', 'supervisor'].includes(String(u.role)) || u.receivesLeads || u.developer);
  const managers = (users || []).filter((u: any) => u.role === 'supervisor' && String(u.team || '').trim());
  const team = managerFilter === 'none'
    ? null
    : new Set((users || []).filter((u: any) => u.team && u.team === managers.find((m: any) => m.id === managerFilter)?.team).map((u: any) => String(u.id)));

  const numbers = data.numbers.filter((n: any) => {
    // الأرقام غير الموزّعة بتتعدّ في «الكل» و«Pending» بس لما مفيش فلتر سيلز/فريق
    if (!n.ownerId) return salesFilter === 'all' && !team && currentUser?.role === 'admin';
    if (!scope.has(n.ownerId)) return false;
    if (salesFilter !== 'all' && n.ownerId !== salesFilter) return false;
    if (team && !team.has(n.ownerId)) return false;
    return true;
  });

  const assigned = (n: any) => !!n.ownerId;
  const cards: Card[] = [
    { id: 'all', label: 'All Leads', match: () => true },
    { id: 'fresh', label: 'Fresh Leads', match: (n) => assigned(n) && n.bucket === 'fresh-stage' },
    { id: 'pending', label: 'Pending Leads', match: (n) => !assigned(n) },
    { id: 'follow', label: 'Following', match: (n) => assigned(n) && n.bucket === 'follow-up' },
    { id: 'meeting', label: 'Meeting', match: (n) => assigned(n) && n.bucket === 'meeting' },
    { id: 'after', label: 'Following After Meeting', match: (n) => assigned(n) && n.bucket === 'after-meeting' },
    { id: 'cancel', label: 'Cancellation', match: (n) => assigned(n) && n.bucket === 'cancellation' },
    // رقم كان Fresh واتعمل عليه «No Answer» (خانة No Answer)
    { id: 'na-fresh', label: 'No Answer Fresh', match: (n) => assigned(n) && n.bucket === 'no-answer' },
    { id: 'resched', label: 'Reschedule Meeting', match: (n) => assigned(n) && n.bucket === 'reschedule' },
    { id: 'done', label: 'Done Deal', match: (n) => assigned(n) && n.bucket === 'done-deal' },
    { id: 'reserve', label: 'Reservation', match: (n) => assigned(n) && n.bucket === 'reservation' },
  ];
  const total = numbers.length;
  const percent = (count: number) => (total ? Math.round((count / total) * 1000) / 10 : 0);
  const fieldClass = 'bg-[var(--surface-2,var(--tint-1))] border border-[var(--border)] rounded-[var(--r-md)] px-3 py-2.5 text-sm text-[var(--text-strong)] min-w-[180px]';

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-[var(--text-strong)]">Welcome {currentUser?.name}</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">أرقام كل الخانات عند الفريق — والنسبة من الكل</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label>
            <span className="block text-[11px] text-[var(--text-muted)] mb-1">Sales Rep</span>
            <select value={salesFilter} onChange={(e) => setSalesFilter(e.target.value)} className={fieldClass}>
              <option value="all" className="bg-gray-900">Full Dashboard</option>
              {salesUsers.map((u: any) => <option key={u.id} value={u.id} className="bg-gray-900">{u.name}</option>)}
            </select>
          </label>
          <label>
            <span className="block text-[11px] text-[var(--text-muted)] mb-1">Managers</span>
            <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className={fieldClass}>
              <option value="none" className="bg-gray-900">None</option>
              {managers.map((u: any) => <option key={u.id} value={u.id} className="bg-gray-900">{u.name} — {u.team}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const count = numbers.filter(card.match).length;
          return (
            <div key={card.id} className="panel p-5 min-h-[118px] flex flex-col justify-between">
              <p className="font-bold text-[var(--text-strong)]">{card.label}</p>
              <div className="flex items-end justify-between mt-3">
                <b className="text-3xl font-semibold text-[var(--text-strong)]">{count}</b>
                <span className="text-xs font-bold text-emerald-500 flex items-center gap-0.5">
                  <ArrowUp className="w-3.5 h-3.5" />{card.id === 'all' ? 100 : percent(count)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
