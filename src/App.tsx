import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Bell, Plus, Home, Phone, Clock, Check, 
  AlertTriangle, TrendingUp, Star, Calendar, 
  MessageSquare, X, Edit3, Trash2, Search,
  BarChart3, PhoneCall, UserPlus, Building2
} from 'lucide-react';
import { Client, Reminder, TabType } from './types';
import { 
  getClients, saveClients, getReminders, saveReminders,
  requestNotificationPermission, sendNotification, vibrateDevice,
  formatDateTime, isReminderDue, getTimeUntil
} from './utils';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [clients, setClients] = useState<Client[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [notificationPermission, setNotificationPermission] = useState(false);

  // Load data from localStorage
  useEffect(() => {
    setClients(getClients());
    setReminders(getReminders());
    requestNotificationPermission().then(setNotificationPermission);
  }, []);

  // Check reminders every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const currentReminders = getReminders();
      currentReminders.forEach(reminder => {
        if (isReminderDue(reminder) && !reminder.isCompleted) {
          sendNotification(
            '⏰ تذكير بالاتصال',
            `حان وقت الاتصال بـ ${reminder.clientName} - ${reminder.clientPhone}`
          );
          vibrateDevice();
        }
      });
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const addClient = useCallback((client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newClient: Client = {
      ...client,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newClient, ...clients];
    setClients(updated);
    saveClients(updated);
    setShowAddClient(false);
  }, [clients]);

  const updateClient = useCallback((id: string, data: Partial<Client>) => {
    const updated = clients.map(c => 
      c.id === id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c
    );
    setClients(updated);
    saveClients(updated);
    setSelectedClient(null);
  }, [clients]);

  const deleteClient = useCallback((id: string) => {
    const updated = clients.filter(c => c.id !== id);
    setClients(updated);
    saveClients(updated);
    const updatedReminders = reminders.filter(r => r.clientId !== id);
    setReminders(updatedReminders);
    saveReminders(updatedReminders);
  }, [clients, reminders]);

  const addReminder = useCallback((reminder: Omit<Reminder, 'id' | 'isCompleted' | 'isDelayed' | 'delayCount' | 'createdAt'>) => {
    const newReminder: Reminder = {
      ...reminder,
      id: crypto.randomUUID(),
      isCompleted: false,
      isDelayed: false,
      delayCount: 0,
      createdAt: new Date().toISOString(),
    };
    const updated = [newReminder, ...reminders];
    setReminders(updated);
    saveReminders(updated);
    setShowAddReminder(false);
  }, [reminders]);

  const completeReminder = useCallback((id: string) => {
    const updated = reminders.map(r => 
      r.id === id ? { ...r, isCompleted: true } : r
    );
    setReminders(updated);
    saveReminders(updated);
  }, [reminders]);

  const delayReminder = useCallback((id: string, minutes: number) => {
    const updated = reminders.map(r => {
      if (r.id === id) {
        const newTime = new Date(new Date(r.dateTime).getTime() + minutes * 60000);
        return { 
          ...r, 
          dateTime: newTime.toISOString(), 
          isDelayed: true,
          delayCount: r.delayCount + 1 
        };
      }
      return r;
    });
    setReminders(updated);
    saveReminders(updated);
  }, [reminders]);

  const deleteReminder = useCallback((id: string) => {
    const updated = reminders.filter(r => r.id !== id);
    setReminders(updated);
    saveReminders(updated);
  }, [reminders]);

  const filteredClients = clients.filter(c => 
    c.name.includes(searchTerm) || 
    c.phone.includes(searchTerm) || 
    c.property.includes(searchTerm)
  );

  const activeReminders = reminders.filter(r => !r.isCompleted);
  const dueReminders = reminders.filter(r => isReminderDue(r));
  const stats = {
    totalClients: clients.length,
    activeReminders: activeReminders.length,
    dueNow: dueReminders.length,
    newClients: clients.filter(c => c.status === 'new').length,
    interested: clients.filter(c => c.status === 'interested').length,
    closed: clients.filter(c => c.status === 'closed').length,
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gold-500/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-gold-600/5 rounded-full blur-3xl"></div>
      </div>

      {/* Header */}
      <header className="relative z-10 glass-card border-b border-gold-500/20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            <div className="w-12 h-12 gold-gradient rounded-xl flex items-center justify-center shadow-lg shadow-gold-500/20">
              <Building2 className="w-7 h-7 text-black" />
            </div>
            <div>
              <h1 className="text-xl font-bold gold-text">CRM العقارات</h1>
              <p className="text-xs text-gray-400">نظام إدارة العملاء</p>
            </div>
          </motion.div>
          
          <div className="flex items-center gap-3">
            {stats.dueNow > 0 && (
              <motion.div 
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="notification-badge relative"
              >
                <Bell className="w-6 h-6 text-gold-400" />
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold">
                  {stats.dueNow}
                </span>
              </motion.div>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowAddClient(true)}
              className="gold-gradient text-black px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg shadow-gold-500/20"
            >
              <Plus className="w-4 h-4" />
              عميل جديد
            </motion.button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="relative z-10 glass-card border-b border-gold-500/10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {[
              { id: 'dashboard' as TabType, icon: Home, label: 'الرئيسية' },
              { id: 'clients' as TabType, icon: Users, label: 'العملاء' },
              { id: 'reminders' as TabType, icon: Bell, label: 'التذكيرات' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all duration-300 border-b-2 whitespace-nowrap ${
                  activeTab === tab.id 
                    ? 'border-gold-400 text-gold-400' 
                    : 'border-transparent text-gray-400 hover:text-gold-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'reminders' && stats.dueNow > 0 && (
                  <span className="w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center text-white">
                    {stats.dueNow}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <DashboardView 
                stats={stats} 
                clients={clients}
                reminders={reminders}
                onComplete={completeReminder}
                onDelay={delayReminder}
              />
            </motion.div>
          )}

          {activeTab === 'clients' && (
            <motion.div
              key="clients"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <ClientsView 
                clients={filteredClients}
                searchTerm={searchTerm}
                onSearch={setSearchTerm}
                onSelect={setSelectedClient}
                onDelete={deleteClient}
                onAdd={() => setShowAddClient(true)}
              />
            </motion.div>
          )}

          {activeTab === 'reminders' && (
            <motion.div
              key="reminders"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <RemindersView 
                reminders={reminders}
                onComplete={completeReminder}
                onDelay={delayReminder}
                onDelete={deleteReminder}
                onAdd={() => setShowAddReminder(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showAddClient && (
          <AddClientModal 
            onClose={() => setShowAddClient(false)} 
            onAdd={addClient} 
          />
        )}
        {showAddReminder && (
          <AddReminderModal 
            clients={clients}
            onClose={() => setShowAddReminder(false)} 
            onAdd={addReminder} 
          />
        )}
        {selectedClient && (
          <ClientDetailModal 
            client={selectedClient}
            onClose={() => setSelectedClient(null)}
            onUpdate={updateClient}
            onDelete={() => { deleteClient(selectedClient.id); setSelectedClient(null); }}
            onAddReminder={(clientId, clientName, clientPhone) => {
              setSelectedClient(null);
              setShowAddReminder(true);
              // Pre-select will be handled by state
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Dashboard Component
function DashboardView({ stats, clients, reminders, onComplete, onDelay }: {
  stats: any;
  clients: Client[];
  reminders: Reminder[];
  onComplete: (id: string) => void;
  onDelay: (id: string, minutes: number) => void;
}) {
  const dueReminders = reminders.filter(r => isReminderDue(r) && !r.isCompleted);
  
  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'إجمالي العملاء', value: stats.totalClients, icon: Users, color: 'from-gold-400 to-gold-600' },
          { label: 'عملاء جدد', value: stats.newClients, icon: UserPlus, color: 'from-blue-400 to-blue-600' },
          { label: 'مهتمين', value: stats.interested, icon: Star, color: 'from-green-400 to-green-600' },
          { label: 'تم الإغلاق', value: stats.closed, icon: Check, color: 'from-purple-400 to-purple-600' },
          { label: 'تذكيرات نشطة', value: stats.activeReminders, icon: Clock, color: 'from-orange-400 to-orange-600' },
          { label: 'مستحقة الآن', value: stats.dueNow, icon: AlertTriangle, color: 'from-red-400 to-red-600' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card rounded-xl p-4 hover:border-gold-500/50 transition-all duration-300"
          >
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center mb-3`}>
              <stat.icon className="w-5 h-5 text-white" />
            </div>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Due Reminders */}
      {dueReminders.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-xl p-6 border-red-500/30 glow-border"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-red-400">⚠️ تذكيرات مستحقة الآن</h3>
              <p className="text-sm text-gray-400">يجب الاتصال بهذه العملاء</p>
            </div>
          </div>
          <div className="space-y-3">
            {dueReminders.map((reminder, i) => (
              <motion.div
                key={reminder.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <p className="font-bold text-white">{reminder.clientName}</p>
                  <p className="text-sm text-gray-400">{reminder.clientPhone}</p>
                  <p className="text-xs text-red-400 mt-1">{reminder.note}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onComplete(reminder.id)}
                    className="p-2 bg-green-500/20 rounded-lg hover:bg-green-500/30 transition-colors"
                    title="تم الاتصال"
                  >
                    <Check className="w-4 h-4 text-green-400" />
                  </button>
                  <button
                    onClick={() => onDelay(reminder.id, 30)}
                    className="p-2 bg-orange-500/20 rounded-lg hover:bg-orange-500/30 transition-colors"
                    title="تأجيل 30 دقيقة"
                  >
                    <Clock className="w-4 h-4 text-orange-400" />
                  </button>
                  <a
                    href={`tel:${reminder.clientPhone}`}
                    className="p-2 bg-gold-500/20 rounded-lg hover:bg-gold-500/30 transition-colors"
                    title="اتصال"
                  >
                    <PhoneCall className="w-4 h-4 text-gold-400" />
                  </a>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Recent Clients */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-bold gold-text mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          آخر العملاء المضافين
        </h3>
        <div className="space-y-3">
          {clients.slice(0, 5).map((client, i) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 gold-gradient rounded-full flex items-center justify-center">
                  <span className="text-black font-bold text-sm">{client.name[0]}</span>
                </div>
                <div>
                  <p className="font-medium text-white">{client.name}</p>
                  <p className="text-xs text-gray-400">{client.phone}</p>
                </div>
              </div>
              <StatusBadge status={client.status} />
            </motion.div>
          ))}
          {clients.length === 0 && (
            <p className="text-center text-gray-500 py-8">لا يوجد عملاء بعد</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Clients View
function ClientsView({ clients, searchTerm, onSearch, onSelect, onDelete, onAdd }: {
  clients: Client[];
  searchTerm: string;
  onSearch: (term: string) => void;
  onSelect: (client: Client) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Search & Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="بحث بالاسم أو رقم الهاتف أو العقار..."
            value={searchTerm}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-white/5 border border-gold-500/20 rounded-xl pr-11 pl-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
          />
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onAdd}
          className="gold-gradient text-black px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-gold-500/20"
        >
          <Plus className="w-5 h-5" />
          إضافة عميل
        </motion.button>
      </div>

      {/* Client Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {clients.map((client, i) => (
          <motion.div
            key={client.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onSelect(client)}
            className="glass-card rounded-xl p-5 cursor-pointer hover:border-gold-500/50 transition-all duration-300 group"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 gold-gradient rounded-full flex items-center justify-center group-hover:animate-pulse-gold">
                  <span className="text-black font-bold">{client.name[0]}</span>
                </div>
                <div>
                  <h4 className="font-bold text-white">{client.name}</h4>
                  <p className="text-sm text-gray-400 flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {client.phone}
                  </p>
                </div>
              </div>
              <StatusBadge status={client.status} />
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-gray-300 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-gold-400" />
                {client.property || 'لم يحدد العقار'}
              </p>
              {client.feedback && (
                <p className="text-gray-400 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-gold-400" />
                  <span className="truncate">{client.feedback}</span>
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </div>
      
      {clients.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16"
        >
          <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">لا يوجد عملاء</p>
          <p className="text-gray-500 text-sm mt-2">اضغط على "إضافة عميل" لبدء إضافة عملائك</p>
        </motion.div>
      )}
    </div>
  );
}

// Reminders View
function RemindersView({ reminders, onComplete, onDelay, onDelete, onAdd }: {
  reminders: Reminder[];
  onComplete: (id: string) => void;
  onDelay: (id: string, minutes: number) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  const pending = reminders.filter(r => !r.isCompleted);
  const completed = reminders.filter(r => r.isCompleted);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gold-text flex items-center gap-2">
          <Bell className="w-6 h-6" />
          التذكيرات
        </h2>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onAdd}
          className="gold-gradient text-black px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-gold-500/20"
        >
          <Plus className="w-4 h-4" />
          تذكير جديد
        </motion.button>
      </div>

      {/* Pending Reminders */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-400">التذكيرات القادمة ({pending.length})</h3>
          {pending.map((reminder, i) => {
            const isDue = isReminderDue(reminder);
            return (
              <motion.div
                key={reminder.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`glass-card rounded-xl p-4 ${isDue ? 'border-red-500/50 animate-pulse-gold' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-bold text-white">{reminder.clientName}</h4>
                      {reminder.isDelayed && (
                        <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                          مؤجل ({reminder.delayCount})
                        </span>
                      )}
                      {isDue && (
                        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full animate-pulse">
                          مستحق الآن!
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gold-400 flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {reminder.clientPhone}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDateTime(reminder.dateTime)}
                    </p>
                    {!isDue && (
                      <p className="text-xs text-green-400 mt-1">
                        ⏳ متبقي: {getTimeUntil(reminder)}
                      </p>
                    )}
                    {reminder.note && (
                      <p className="text-sm text-gray-300 mt-2">{reminder.note}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mr-4">
                    <button
                      onClick={() => onComplete(reminder.id)}
                      className="p-2 bg-green-500/20 rounded-lg hover:bg-green-500/30 transition-colors"
                      title="تم الاتصال"
                    >
                      <Check className="w-4 h-4 text-green-400" />
                    </button>
                    <button
                      onClick={() => onDelay(reminder.id, 30)}
                      className="p-2 bg-orange-500/20 rounded-lg hover:bg-orange-500/30 transition-colors"
                      title="تأجيل 30 دقيقة"
                    >
                      <Clock className="w-4 h-4 text-orange-400" />
                    </button>
                    <button
                      onClick={() => onDelay(reminder.id, 60)}
                      className="p-2 bg-blue-500/20 rounded-lg hover:bg-blue-500/30 transition-colors text-xs font-bold"
                      title="تأجيل ساعة"
                    >
                      <span className="text-blue-400">+1h</span>
                    </button>
                    <a
                      href={`tel:${reminder.clientPhone}`}
                      className="p-2 bg-gold-500/20 rounded-lg hover:bg-gold-500/30 transition-colors"
                      title="اتصال"
                    >
                      <PhoneCall className="w-4 h-4 text-gold-400" />
                    </a>
                    <button
                      onClick={() => onDelete(reminder.id)}
                      className="p-2 bg-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Completed Reminders */}
      {completed.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-400">تم الاتصال ({completed.length})</h3>
          {completed.slice(0, 5).map((reminder, i) => (
            <motion.div
              key={reminder.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card rounded-xl p-4 opacity-60"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-white line-through">{reminder.clientName}</h4>
                  <p className="text-xs text-gray-400">{reminder.clientPhone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">
                    ✓ تم
                  </span>
                  <button
                    onClick={() => onDelete(reminder.id)}
                    className="p-1.5 bg-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {reminders.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16"
        >
          <Bell className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">لا يوجد تذكيرات</p>
          <p className="text-gray-500 text-sm mt-2">أضف تذكير لمكالمة عميل في وقت محدد</p>
        </motion.div>
      )}
    </div>
  );
}

// Add Client Modal
function AddClientModal({ onClose, onAdd }: { 
  onClose: () => void; 
  onAdd: (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>) => void 
}) {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    property: '',
    budget: '',
    status: 'new' as Client['status'],
    feedback: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone) return;
    onAdd(form);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-card rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border-gold-500/30"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold gold-text flex items-center gap-2">
            <UserPlus className="w-6 h-6" />
            إضافة عميل جديد
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">الاسم *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
              placeholder="اسم العميل"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">رقم الهاتف *</label>
            <input
              type="tel"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
              placeholder="05xxxxxxxx"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">البريد الإلكتروني</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
              placeholder="email@example.com"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">العقار المطلوب</label>
            <input
              type="text"
              value={form.property}
              onChange={(e) => setForm({ ...form, property: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
              placeholder="شقة، فيلا، أرض..."
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">الميزانية</label>
            <input
              type="text"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
              placeholder="الميزانية المتوقعة"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">الحالة</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Client['status'] })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
            >
              <option value="new" className="bg-gray-900">جديد</option>
              <option value="contacted" className="bg-gray-900">تم التواصل</option>
              <option value="interested" className="bg-gray-900">مهتم</option>
              <option value="negotiation" className="bg-gray-900">تفاوض</option>
              <option value="closed" className="bg-gray-900">تم الإغلاق</option>
              <option value="lost" className="bg-gray-900">مفقود</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">ملاحظات / فيدباك</label>
            <textarea
              value={form.feedback}
              onChange={(e) => setForm({ ...form, feedback: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors resize-none h-24"
              placeholder="أي ملاحظات عن العميل..."
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            type="submit"
            className="w-full gold-gradient text-black py-3 rounded-xl font-bold text-lg shadow-lg shadow-gold-500/20"
          >
            إضافة العميل
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Add Reminder Modal
function AddReminderModal({ clients, onClose, onAdd }: {
  clients: Client[];
  onClose: () => void;
  onAdd: (reminder: Omit<Reminder, 'id' | 'isCompleted' | 'isDelayed' | 'delayCount' | 'createdAt'>) => void;
}) {
  const [form, setForm] = useState({
    clientId: '',
    clientName: '',
    clientPhone: '',
    dateTime: '',
    note: '',
  });

  const handleClientSelect = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setForm({ ...form, clientId, clientName: client.name, clientPhone: client.phone });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientName || !form.clientPhone || !form.dateTime) return;
    onAdd(form);
  };

  // Set minimum datetime to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const minDateTime = now.toISOString().slice(0, 16);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-card rounded-2xl p-6 w-full max-w-lg border-gold-500/30"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold gold-text flex items-center gap-2">
            <Bell className="w-6 h-6" />
            إضافة تذكير
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {clients.length > 0 && (
            <div>
              <label className="block text-sm text-gray-300 mb-1">اختر عميل</label>
              <select
                value={form.clientId}
                onChange={(e) => handleClientSelect(e.target.value)}
                className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
              >
                <option value="" className="bg-gray-900">-- اختر عميل --</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id} className="bg-gray-900">
                    {c.name} - {c.phone}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-300 mb-1">اسم العميل *</label>
            <input
              type="text"
              required
              value={form.clientName}
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
              placeholder="اسم العميل"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">رقم الهاتف *</label>
            <input
              type="tel"
              required
              value={form.clientPhone}
              onChange={(e) => setForm({ ...form, clientPhone: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
              placeholder="05xxxxxxxx"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">وقت التذكير *</label>
            <input
              type="datetime-local"
              required
              min={minDateTime}
              value={form.dateTime}
              onChange={(e) => setForm({ ...form, dateTime: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">ملاحظة</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 transition-colors resize-none h-20"
              placeholder="سبب المكالمة أو ملاحظة..."
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            type="submit"
            className="w-full gold-gradient text-black py-3 rounded-xl font-bold text-lg shadow-lg shadow-gold-500/20"
          >
            إضافة التذكير
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Client Detail Modal
function ClientDetailModal({ client, onClose, onUpdate, onDelete, onAddReminder }: {
  client: Client;
  onClose: () => void;
  onUpdate: (id: string, data: Partial<Client>) => void;
  onDelete: () => void;
  onAddReminder: (clientId: string, clientName: string, clientPhone: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: client.name,
    phone: client.phone,
    email: client.email,
    property: client.property,
    budget: client.budget,
    status: client.status,
    feedback: client.feedback,
  });

  const handleSave = () => {
    onUpdate(client.id, form);
    setEditing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-card rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border-gold-500/30"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold gold-text">تفاصيل العميل</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 gold-gradient rounded-full flex items-center justify-center">
            <span className="text-black font-bold text-2xl">{client.name[0]}</span>
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">{client.name}</h3>
            <StatusBadge status={client.status} />
          </div>
        </div>

        {editing ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">الاسم</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">الهاتف</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">البريد</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">العقار</label>
              <input
                type="text"
                value={form.property}
                onChange={(e) => setForm({ ...form, property: e.target.value })}
                className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">الميزانية</label>
              <input
                type="text"
                value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })}
                className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">الحالة</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as Client['status'] })}
                className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50"
              >
                <option value="new" className="bg-gray-900">جديد</option>
                <option value="contacted" className="bg-gray-900">تم التواصل</option>
                <option value="interested" className="bg-gray-900">مهتم</option>
                <option value="negotiation" className="bg-gray-900">تفاوض</option>
                <option value="closed" className="bg-gray-900">تم الإغلاق</option>
                <option value="lost" className="bg-gray-900">مفقود</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">ملاحظات</label>
              <textarea
                value={form.feedback}
                onChange={(e) => setForm({ ...form, feedback: e.target.value })}
                className="w-full bg-white/5 border border-gold-500/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-gold-500/50 resize-none h-24"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                className="flex-1 gold-gradient text-black py-3 rounded-xl font-bold"
              >
                حفظ
              </button>
              <button
                onClick={() => setEditing(false)}
                className="flex-1 bg-white/10 text-white py-3 rounded-xl font-bold hover:bg-white/20 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-xs text-gray-400">الهاتف</p>
                <p className="text-white font-medium" dir="ltr">{client.phone}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-xs text-gray-400">البريد</p>
                <p className="text-white font-medium text-sm" dir="ltr">{client.email || '-'}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-xs text-gray-400">العقار</p>
                <p className="text-white font-medium">{client.property || '-'}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-xs text-gray-400">الميزانية</p>
                <p className="text-white font-medium">{client.budget || '-'}</p>
              </div>
            </div>
            {client.feedback && (
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-xs text-gray-400 mb-1">ملاحظات</p>
                <p className="text-white text-sm">{client.feedback}</p>
              </div>
            )}
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-xs text-gray-400">تاريخ الإضافة</p>
              <p className="text-white text-sm">{formatDateTime(client.createdAt)}</p>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={() => setEditing(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-gold-500/20 text-gold-400 py-2.5 rounded-xl hover:bg-gold-500/30 transition-colors"
              >
                <Edit3 className="w-4 h-4" />
                تعديل
              </button>
              <a
                href={`tel:${client.phone}`}
                className="flex-1 flex items-center justify-center gap-2 bg-green-500/20 text-green-400 py-2.5 rounded-xl hover:bg-green-500/30 transition-colors"
              >
                <PhoneCall className="w-4 h-4" />
                اتصال
              </a>
              <button
                onClick={() => onAddReminder(client.id, client.name, client.phone)}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-500/20 text-blue-400 py-2.5 rounded-xl hover:bg-blue-500/30 transition-colors"
              >
                <Bell className="w-4 h-4" />
                تذكير
              </button>
              <button
                onClick={onDelete}
                className="flex items-center justify-center gap-2 bg-red-500/20 text-red-400 py-2.5 px-4 rounded-xl hover:bg-red-500/30 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// Status Badge Component
function StatusBadge({ status }: { status: Client['status'] }) {
  const config = {
    new: { label: 'جديد', color: 'bg-blue-500/20 text-blue-400' },
    contacted: { label: 'تم التواصل', color: 'bg-purple-500/20 text-purple-400' },
    interested: { label: 'مهتم', color: 'bg-green-500/20 text-green-400' },
    negotiation: { label: 'تفاوض', color: 'bg-orange-500/20 text-orange-400' },
    closed: { label: 'تم الإغلاق', color: 'bg-gold-500/20 text-gold-400' },
    lost: { label: 'مفقود', color: 'bg-red-500/20 text-red-400' },
  };

  const { label, color } = config[status];

  return (
    <span className={`text-xs px-2.5 py-1 rounded-full ${color}`}>
      {label}
    </span>
  );
}

export default App;
