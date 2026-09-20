import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Bell, Plus, Home, Phone, Clock, Check, 
  AlertTriangle, Star, Calendar, 
  MessageSquare, X, Edit3, Trash2, Search,
  PhoneCall, UserPlus, Building2, Sparkles,
  Zap, Target, Award, Volume2, VolumeX
} from 'lucide-react';
import { Client, Reminder, TabType } from './types';
import { 
  getClients, saveClients, getReminders, saveReminders,
  requestNotificationPermission, sendNotification, vibrateDevice,
  formatDateTime, isReminderDue, getTimeUntil,
  getNotifiedReminders, addNotifiedReminder, playNotificationSound
} from './utils';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [clients, setClients] = useState<Client[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [inAppNotification, setInAppNotification] = useState<{title: string, body: string} | null>(null);

  // Show permission modal on first load
  useEffect(() => {
    const hasAsked = localStorage.getItem('notification_permission_asked');
    if (!hasAsked) {
      const timer = setTimeout(() => {
        setShowPermissionModal(true);
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      if ('Notification' in window) {
        setNotificationPermission(Notification.permission === 'granted');
      }
    }
  }, []);

  const handlePermissionRequest = async () => {
    const granted = await requestNotificationPermission();
    setNotificationPermission(granted);
    localStorage.setItem('notification_permission_asked', 'true');
    setShowPermissionModal(false);
  };

  const handleDenyPermission = () => {
    localStorage.setItem('notification_permission_asked', 'true');
    setShowPermissionModal(false);
  };

  // Load data
  useEffect(() => {
    setClients(getClients());
    setReminders(getReminders());
  }, []);

  // Check reminders every 5 seconds
  useEffect(() => {
    const checkReminders = () => {
      const currentReminders = getReminders();
      const notifiedIds = getNotifiedReminders();
      
      currentReminders.forEach(reminder => {
        if (isReminderDue(reminder) && !reminder.isCompleted && !notifiedIds.includes(reminder.id)) {
          // Mark as notified
          addNotifiedReminder(reminder.id);
          
          // Play sound
          if (soundEnabled) {
            playNotificationSound();
          }
          
          // Vibrate device
          vibrateDevice();
          
          // Send browser notification (works even when tab is in background)
          sendNotification(
            '⏰ تذكير بالاتصال بعميل',
            `حان وقت الاتصال بـ ${reminder.clientName}\n${reminder.clientPhone}\n${reminder.note || ''}`,
            `reminder-${reminder.id}`
          );
          
          // Show in-app notification
          setInAppNotification({
            title: `⏰ حان وقت الاتصال بـ ${reminder.clientName}`,
            body: `${reminder.clientPhone} - ${reminder.note || 'تذكير بمكالمة'}`
          });
          
          // Auto-hide in-app notification after 10 seconds
          setTimeout(() => {
            setInAppNotification(null);
          }, 10000);
        }
      });
    };

    // Check immediately
    checkReminders();
    
    // Then check every 5 seconds
    const interval = setInterval(checkReminders, 5000);
    return () => clearInterval(interval);
  }, [soundEnabled]);

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
    // Clear from notified so it can notify again when due
    const notified = getNotifiedReminders().filter(nid => nid !== id);
    localStorage.setItem('crm_notified_reminders', JSON.stringify(notified));
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
    campaignClients: clients.filter(c => c.status === 'campaign').length,
    facebookClients: clients.filter(c => c.status === 'facebook').length,
    externalClients: clients.filter(c => c.status === 'external').length,
  };

  return (
    <div className="min-h-screen bg-[#030014] text-white relative overflow-hidden">
      {/* Background Orbs */}
      <div className="bg-orb bg-orb-1"></div>
      <div className="bg-orb bg-orb-2"></div>
      <div className="bg-orb bg-orb-3"></div>

      {/* In-App Notification */}
      <AnimatePresence>
        {inAppNotification && (
          <motion.div
            initial={{ opacity: 0, y: -100, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -100, scale: 0.8 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4"
          >
            <div className="glass-card rounded-2xl p-4 border-purple-400/50 glow-primary animate-pulse-glow">
              <div className="flex items-start gap-3">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                  className="w-10 h-10 gradient-primary rounded-full flex items-center justify-center flex-shrink-0"
                >
                  <Bell className="w-5 h-5 text-white" />
                </motion.div>
                <div className="flex-1">
                  <p className="font-bold text-white text-sm">{inAppNotification.title}</p>
                  <p className="text-gray-300 text-xs mt-1">{inAppNotification.body}</p>
                </div>
                <button 
                  onClick={() => setInAppNotification(null)}
                  className="p-1 hover:bg-white/10 rounded-lg"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="relative z-10 glass-card border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            <motion.div 
              whileHover={{ rotate: 360, scale: 1.1 }}
              transition={{ duration: 0.6 }}
              className="w-12 h-12 gradient-primary rounded-xl flex items-center justify-center shadow-lg glow-primary"
            >
              <Building2 className="w-7 h-7 text-white" />
            </motion.div>
            <div>
              <h1 className="text-xl font-bold gradient-text">Muhammed CRM</h1>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-400" />
                نظام CRM الخاص بمحمد
              </p>
            </div>
          </motion.div>
          
          <div className="flex items-center gap-3">
            {/* Sound Toggle */}
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${
                soundEnabled ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 text-gray-500'
              }`}
              title={soundEnabled ? 'كتم الصوت' : 'تفعيل الصوت'}
            >
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </motion.button>

            {!notificationPermission && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                whileHover={{ scale: 1.05 }}
                onClick={() => setShowPermissionModal(true)}
                className="flex items-center gap-2 bg-purple-500/20 text-purple-300 px-3 py-2 rounded-lg text-sm border border-purple-500/30"
              >
                <Bell className="w-4 h-4" />
                <span className="hidden sm:inline">تفعيل الإشعارات</span>
              </motion.button>
            )}
            
            <motion.button 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setActiveTab('reminders')}
              className="relative p-2 bg-purple-500/20 rounded-lg hover:bg-purple-500/30 transition-colors"
              title="التذكيرات"
            >
              <Bell className="w-6 h-6 text-purple-400" />
              {stats.dueNow > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold animate-pulse">
                  {stats.dueNow}
                </span>
              )}
            </motion.button>
            
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowAddClient(true)}
              className="gradient-primary text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover"
            >
              <Plus className="w-4 h-4" />
              عميل جديد
            </motion.button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="relative z-10 glass-card border-b border-purple-500/10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {[
              { id: 'dashboard' as TabType, icon: Home, label: 'الرئيسية' },
              { id: 'clients' as TabType, icon: Users, label: 'العملاء' },
              { id: 'reminders' as TabType, icon: Bell, label: 'التذكيرات' },
            ].map((tab, i) => (
              <motion.button
                key={tab.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all duration-300 border-b-2 whitespace-nowrap relative ${
                  activeTab === tab.id 
                    ? 'border-purple-400 text-purple-300' 
                    : 'border-transparent text-gray-400 hover:text-purple-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'reminders' && stats.dueNow > 0 && (
                  <span className="w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center text-white animate-pulse">
                    {stats.dueNow}
                  </span>
                )}
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 gradient-primary"
                  />
                )}
              </motion.button>
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
        {showPermissionModal && (
          <PermissionModal 
            onAllow={handlePermissionRequest}
            onDeny={handleDenyPermission}
          />
        )}
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
            onAddReminder={() => {
              setSelectedClient(null);
              setShowAddReminder(true);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Permission Modal
function PermissionModal({ onAllow, onDeny }: { onAllow: () => void; onDeny: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotateY: 90 }}
        animate={{ scale: 1, opacity: 1, rotateY: 0 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ type: "spring", duration: 0.6 }}
        className="glass-card rounded-3xl p-8 w-full max-w-md border-purple-400/30 glow-primary text-center"
      >
        <motion.div
          animate={{ 
            scale: [1, 1.2, 1],
            rotate: [0, 10, -10, 0]
          }}
          transition={{ duration: 2, repeat: Infinity }}
          className="w-20 h-20 gradient-primary rounded-full flex items-center justify-center mx-auto mb-6 glow-primary"
        >
          <Bell className="w-10 h-10 text-white" />
        </motion.div>
        
        <h2 className="text-2xl font-bold gradient-text mb-3">تفعيل الإشعارات والصوت</h2>
        <p className="text-gray-300 mb-2">
          هل تريد تفعيل الإشعارات والصوت؟
        </p>
        <p className="text-gray-400 text-sm mb-6">
          سنرسل لك إشعارات مع صوت عند حلول وقت الاتصال بالعملاء حتى لو كنت خارج الصفحة
        </p>
        
        <div className="flex gap-3">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onAllow}
            className="flex-1 gradient-primary text-white py-3 rounded-xl font-bold btn-hover glow-primary"
          >
            <span className="flex items-center justify-center gap-2">
              <Check className="w-5 h-5" />
              السماح
            </span>
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onDeny}
            className="flex-1 bg-white/10 text-white py-3 rounded-xl font-bold hover:bg-white/20 transition-colors border border-white/10"
          >
            لاحقاً
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
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
  
  const statCards = [
    { label: 'إجمالي العملاء', value: stats.totalClients, icon: Users, gradient: 'from-purple-500 to-violet-600' },
    { label: 'عملاء كامبين', value: stats.campaignClients, icon: UserPlus, gradient: 'from-violet-500 to-purple-600' },
    { label: 'عملاء فيسبوك', value: stats.facebookClients, icon: Star, gradient: 'from-emerald-500 to-purple-500' },
    { label: 'عملاء خارجي', value: stats.externalClients, icon: Award, gradient: 'from-purple-500 to-pink-500' },
    { label: 'تذكيرات نشطة', value: stats.activeReminders, icon: Clock, gradient: 'from-pink-500 to-purple-500' },
    { label: 'مستحقة الآن', value: stats.dueNow, icon: Zap, gradient: 'from-amber-500 to-purple-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-6 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-full opacity-10">
          <div className="absolute top-0 right-0 w-40 h-40 gradient-primary rounded-full blur-3xl animate-float"></div>
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-violet-500 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }}></div>
        </div>
        <div className="relative z-10">
          <h2 className="text-2xl font-bold gradient-text mb-2">مرحباً بك 👋</h2>
          <p className="text-gray-300">إليك نظرة عامة على نشاطك اليوم</p>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.1, type: "spring" }}
            whileHover={{ scale: 1.05, y: -5 }}
            className="glass-card rounded-2xl p-4 card-hover"
          >
            <motion.div 
              whileHover={{ rotate: 360 }}
              transition={{ duration: 0.5 }}
              className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-3 shadow-lg`}
            >
              <stat.icon className="w-6 h-6 text-white" />
            </motion.div>
            <p className="text-3xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Due Reminders */}
      {dueReminders.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-2xl p-6 border-red-500/30"
          style={{ boxShadow: '0 0 30px rgba(239, 68, 68, 0.2)' }}
        >
          <div className="flex items-center gap-3 mb-4">
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center"
            >
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </motion.div>
            <div>
              <h3 className="text-lg font-bold text-red-400">⚠️ تذكيرات مستحقة الآن</h3>
              <p className="text-sm text-gray-400">يجب الاتصال بهذه العملاء فوراً</p>
            </div>
          </div>
          <div className="space-y-3">
            {dueReminders.map((reminder, i) => (
              <motion.div
                key={reminder.id}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ scale: 1.01 }}
                className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-center justify-between"
              >
                <div>
                  <p className="font-bold text-white text-lg">{reminder.clientName}</p>
                  <p className="text-sm text-gray-400" dir="ltr">{reminder.clientPhone}</p>
                  <p className="text-xs text-red-400 mt-1">{reminder.note}</p>
                </div>
                <div className="flex items-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onComplete(reminder.id)}
                    className="p-2.5 bg-emerald-500/20 rounded-xl hover:bg-emerald-500/30 transition-colors"
                    title="تم الاتصال"
                  >
                    <Check className="w-5 h-5 text-emerald-400" />
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onDelay(reminder.id, 30)}
                    className="p-2.5 bg-amber-500/20 rounded-xl hover:bg-amber-500/30 transition-colors"
                    title="تأجيل 30 دقيقة"
                  >
                    <Clock className="w-5 h-5 text-amber-400" />
                  </motion.button>
                  <motion.a
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    href={`tel:${reminder.clientPhone}`}
                    className="p-2.5 bg-cyan-500/20 rounded-xl hover:bg-cyan-500/30 transition-colors"
                    title="اتصال"
                  >
                    <PhoneCall className="w-5 h-5 text-cyan-400" />
                  </motion.a>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Recent Clients */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-lg font-bold gradient-text mb-4 flex items-center gap-2">
          <Target className="w-5 h-5" />
          آخر العملاء المضافين
        </h3>
        <div className="space-y-3">
          {clients.slice(0, 5).map((client, i) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              whileHover={{ x: -5, scale: 1.01 }}
              className="flex items-center justify-between p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <motion.div 
                  whileHover={{ scale: 1.2, rotate: 10 }}
                  className="w-11 h-11 gradient-primary rounded-full flex items-center justify-center shadow-lg"
                >
                  <span className="text-white font-bold text-sm">{client.name[0]}</span>
                </motion.div>
                <div>
                  <p className="font-medium text-white">{client.name}</p>
                  <p className="text-xs text-gray-400" dir="ltr">{client.phone}</p>
                </div>
              </div>
              <StatusBadge status={client.status} />
            </motion.div>
          ))}
          {clients.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-8"
            >
              <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500">لا يوجد عملاء بعد</p>
            </motion.div>
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
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex-1 relative"
        >
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="بحث بالاسم أو رقم الهاتف أو العقار..."
            value={searchTerm}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl pr-11 pl-4 py-3 text-white placeholder-gray-500 focus:border-purple-500/50 transition-all"
          />
        </motion.div>
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onAdd}
          className="gradient-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg glow-primary btn-hover"
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
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={{ scale: 1.02, y: -5 }}
            onClick={() => onSelect(client)}
            className="glass-card rounded-2xl p-5 cursor-pointer card-hover animated-border"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <motion.div 
                  whileHover={{ scale: 1.2, rotate: 360 }}
                  transition={{ duration: 0.5 }}
                  className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center shadow-lg"
                >
                  <span className="text-white font-bold">{client.name[0]}</span>
                </motion.div>
                <div>
                  <h4 className="font-bold text-white">{client.name}</h4>
                  <p className="text-sm text-gray-400 flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    <span dir="ltr">{client.phone}</span>
                  </p>
                </div>
              </div>
              <StatusBadge status={client.status} />
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-gray-300 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-purple-400" />
                {client.property || 'لم يحدد العقار'}
              </p>
              {client.feedback && (
                <p className="text-gray-400 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-purple-400" />
                  <span className="truncate">{client.feedback}</span>
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </div>
      
      {clients.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-16"
        >
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          </motion.div>
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
        <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
          <Bell className="w-6 h-6" />
          التذكيرات
        </h2>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onAdd}
          className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover"
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
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ scale: 1.01 }}
                className={`glass-card rounded-2xl p-4 ${isDue ? 'border-red-500/50' : ''}`}
                style={isDue ? { boxShadow: '0 0 20px rgba(239, 68, 68, 0.3)' } : {}}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-bold text-white text-lg">{reminder.clientName}</h4>
                      {reminder.isDelayed && (
                        <motion.span 
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full"
                        >
                          مؤجل ({reminder.delayCount})
                        </motion.span>
                      )}
                      {isDue && (
                        <motion.span 
                          animate={{ opacity: [1, 0.5, 1] }}
                          transition={{ duration: 1, repeat: Infinity }}
                          className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full"
                        >
                          🔴 مستحق الآن!
                        </motion.span>
                      )}
                    </div>
                    <p className="text-sm text-purple-400 flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      <span dir="ltr">{reminder.clientPhone}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatDateTime(reminder.dateTime)}
                    </p>
                    {!isDue && (
                      <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        متبقي: {getTimeUntil(reminder)}
                      </p>
                    )}
                    {reminder.note && (
                      <p className="text-sm text-gray-300 mt-2 bg-white/5 rounded-lg p-2">{reminder.note}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mr-4 flex-wrap justify-end">
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onComplete(reminder.id)}
                      className="p-2 bg-emerald-500/20 rounded-lg hover:bg-emerald-500/30 transition-colors"
                      title="تم الاتصال"
                    >
                      <Check className="w-4 h-4 text-emerald-400" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onDelay(reminder.id, 30)}
                      className="p-2 bg-amber-500/20 rounded-lg hover:bg-amber-500/30 transition-colors"
                      title="تأجيل 30 دقيقة"
                    >
                      <Clock className="w-4 h-4 text-amber-400" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onDelay(reminder.id, 60)}
                      className="p-2 bg-blue-500/20 rounded-lg hover:bg-blue-500/30 transition-colors text-xs font-bold"
                      title="تأجيل ساعة"
                    >
                      <span className="text-blue-400">+1h</span>
                    </motion.button>
                    <motion.a
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      href={`tel:${reminder.clientPhone}`}
                      className="p-2 bg-purple-500/20 rounded-lg hover:bg-purple-500/30 transition-colors"
                      title="اتصال"
                    >
                      <PhoneCall className="w-4 h-4 text-purple-400" />
                    </motion.a>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onDelete(reminder.id)}
                      className="p-2 bg-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </motion.button>
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
                  <p className="text-xs text-gray-400" dir="ltr">{reminder.clientPhone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-full">
                    ✓ تم
                  </span>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onDelete(reminder.id)}
                    className="p-1.5 bg-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </motion.button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {reminders.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-16"
        >
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Bell className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          </motion.div>
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
    property: '',
    budget: '',
    monthlyInstallment: '',
    deliveryPeriod: '',
    status: 'campaign' as Client['status'],
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: 50 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 50 }}
        transition={{ type: "spring", duration: 0.5 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-card rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border-purple-400/30 glow-primary"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
            <UserPlus className="w-6 h-6" />
            إضافة عميل جديد
          </h2>
          <motion.button 
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose} 
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </motion.button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">الاسم *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
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
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="05xxxxxxxx"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">العقار المطلوب</label>
            <input
              type="text"
              value={form.property}
              onChange={(e) => setForm({ ...form, property: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="شقة، فيلا، أرض..."
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">الميزانية</label>
            <input
              type="text"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="الميزانية المتوقعة"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">القسط الشهري</label>
            <input
              type="text"
              value={form.monthlyInstallment}
              onChange={(e) => setForm({ ...form, monthlyInstallment: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="القسط الشهري"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">مدة الاستلام</label>
            <input
              type="text"
              value={form.deliveryPeriod}
              onChange={(e) => setForm({ ...form, deliveryPeriod: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="مدة الاستلام"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">المصدر</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Client['status'] })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
            >
              <option value="campaign" className="bg-gray-900">كامبين</option>
              <option value="facebook" className="bg-gray-900">فيسبوك</option>
              <option value="external" className="bg-gray-900">خارجي</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">ملاحظات / فيدباك</label>
            <textarea
              value={form.feedback}
              onChange={(e) => setForm({ ...form, feedback: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all resize-none h-24"
              placeholder="أي ملاحظات عن العميل..."
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            className="w-full gradient-primary text-white py-3 rounded-xl font-bold text-lg shadow-lg glow-primary btn-hover"
          >
            إضافة العميل ✨
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

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const minDateTime = now.toISOString().slice(0, 16);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: 50 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 50 }}
        transition={{ type: "spring", duration: 0.5 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-card rounded-3xl p-6 w-full max-w-lg border-purple-400/30 glow-primary"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
            <Bell className="w-6 h-6" />
            إضافة تذكير
          </h2>
          <motion.button 
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose} 
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </motion.button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {clients.length > 0 && (
            <div>
              <label className="block text-sm text-gray-300 mb-1">اختر عميل</label>
              <select
                value={form.clientId}
                onChange={(e) => handleClientSelect(e.target.value)}
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
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
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
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
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
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
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">ملاحظة</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all resize-none h-20"
              placeholder="سبب المكالمة أو ملاحظة..."
            />
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            className="w-full gradient-primary text-white py-3 rounded-xl font-bold text-lg shadow-lg glow-primary btn-hover"
          >
            إضافة التذكير 🔔
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
  onAddReminder: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: client.name,
    phone: client.phone,
    property: client.property,
    budget: client.budget,
    monthlyInstallment: client.monthlyInstallment,
    deliveryPeriod: client.deliveryPeriod,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0, y: 50 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 50 }}
        transition={{ type: "spring", duration: 0.5 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-card rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border-purple-400/30 glow-primary"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold gradient-text">تفاصيل العميل</h2>
          <motion.button 
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose} 
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </motion.button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <motion.div 
            whileHover={{ scale: 1.1, rotate: 10 }}
            className="w-16 h-16 gradient-primary rounded-full flex items-center justify-center shadow-lg glow-primary"
          >
            <span className="text-white font-bold text-2xl">{client.name[0]}</span>
          </motion.div>
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
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">الهاتف</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">العقار</label>
              <input
                type="text"
                value={form.property}
                onChange={(e) => setForm({ ...form, property: e.target.value })}
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">الميزانية</label>
              <input
                type="text"
                value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })}
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">القسط الشهري</label>
              <input
                type="text"
                value={form.monthlyInstallment}
                onChange={(e) => setForm({ ...form, monthlyInstallment: e.target.value })}
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">مدة الاستلام</label>
              <input
                type="text"
                value={form.deliveryPeriod}
                onChange={(e) => setForm({ ...form, deliveryPeriod: e.target.value })}
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">المصدر</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as Client['status'] })}
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              >
                <option value="campaign" className="bg-gray-900">كامبين</option>
                <option value="facebook" className="bg-gray-900">فيسبوك</option>
                <option value="external" className="bg-gray-900">خارجي</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">ملاحظات</label>
              <textarea
                value={form.feedback}
                onChange={(e) => setForm({ ...form, feedback: e.target.value })}
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all resize-none h-24"
              />
            </div>
            <div className="flex gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSave}
                className="flex-1 gradient-primary text-white py-3 rounded-xl font-bold btn-hover"
              >
                حفظ ✓
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setEditing(false)}
                className="flex-1 bg-white/10 text-white py-3 rounded-xl font-bold hover:bg-white/20 transition-colors border border-white/10"
              >
                إلغاء
              </motion.button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-colors">
                <p className="text-xs text-gray-400">الهاتف</p>
                <p className="text-white font-medium" dir="ltr">{client.phone}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-colors">
                <p className="text-xs text-gray-400">العقار</p>
                <p className="text-white font-medium">{client.property || '-'}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-colors">
                <p className="text-xs text-gray-400">الميزانية</p>
                <p className="text-white font-medium">{client.budget || '-'}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-colors">
                <p className="text-xs text-gray-400">القسط الشهري</p>
                <p className="text-white font-medium">{client.monthlyInstallment || '-'}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-colors">
                <p className="text-xs text-gray-400">مدة الاستلام</p>
                <p className="text-white font-medium">{client.deliveryPeriod || '-'}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-colors">
                <p className="text-xs text-gray-400">المصدر</p>
                <p className="text-white font-medium">
                  {client.status === 'campaign' ? 'كامبين' : client.status === 'facebook' ? 'فيسبوك' : 'خارجي'}
                </p>
              </div>
            </div>
            {client.feedback && (
              <div className="bg-white/5 rounded-xl p-4 hover:bg-white/10 transition-colors">
                <p className="text-xs text-gray-400 mb-1">ملاحظات</p>
                <p className="text-white text-sm">{client.feedback}</p>
              </div>
            )}
            <div className="bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-colors">
              <p className="text-xs text-gray-400">تاريخ الإضافة</p>
              <p className="text-white text-sm">{formatDateTime(client.createdAt)}</p>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setEditing(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-purple-500/20 text-purple-300 py-2.5 rounded-xl hover:bg-purple-500/30 transition-colors border border-purple-500/20"
              >
                <Edit3 className="w-4 h-4" />
                تعديل
              </motion.button>
              <motion.a
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                href={`tel:${client.phone}`}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-500/20 text-emerald-400 py-2.5 rounded-xl hover:bg-emerald-500/30 transition-colors border border-emerald-500/20"
              >
                <PhoneCall className="w-4 h-4" />
                اتصال
              </motion.a>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onAddReminder}
                className="flex-1 flex items-center justify-center gap-2 bg-purple-500/20 text-purple-400 py-2.5 rounded-xl hover:bg-purple-500/30 transition-colors border border-purple-500/20"
              >
                <Bell className="w-4 h-4" />
                تذكير
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onDelete}
                className="flex items-center justify-center gap-2 bg-red-500/20 text-red-400 py-2.5 px-4 rounded-xl hover:bg-red-500/30 transition-colors border border-red-500/20"
              >
                <Trash2 className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// Status Badge Component
function StatusBadge({ status }: { status: Client['status'] }) {
  const getStatusInfo = () => {
    switch (status) {
      case 'campaign':
        return { label: 'كامبين', className: 'status-new' };
      case 'facebook':
        return { label: 'فيسبوك', className: 'status-contacted' };
      case 'external':
        return { label: 'خارجي', className: 'status-interested' };
      default:
        return { label: 'غير معروف', className: 'status-new' };
    }
  };

  const { label, className } = getStatusInfo();

  return (
    <span className={`text-xs px-2.5 py-1 rounded-full ${className}`}>
      {label}
    </span>
  );
}

export default App;
