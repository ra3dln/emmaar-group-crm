import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Bell, Plus, Home, Phone, Clock, Check, 
  AlertTriangle, Star, Calendar, 
  MessageSquare, X, Edit3, Trash2, Search,
  PhoneCall, UserPlus, Building2, Sparkles,
  Zap, Target, Award, Volume2, VolumeX,
  LogOut, TrendingUp, DollarSign, Filter,
  BarChart3, PieChart, Activity, FileText
} from 'lucide-react';
import { Client, Reminder, Property, DailyFeedback, Task, User, TabType } from './types';
import { 
  getClients, saveClients, getReminders, saveReminders,
  getProperties, saveProperties, getDailyFeedbacks, saveDailyFeedbacks,
  requestNotificationPermission, sendNotification, vibrateDevice,
  formatDateTime, isReminderDue, getTimeUntil,
  getNotifiedReminders, addNotifiedReminder, playNotificationSound,
  formatPrice, parsePrice
} from './utils';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [clients, setClients] = useState<Client[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [dailyFeedbacks, setDailyFeedbacks] = useState<DailyFeedback[]>([]);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showAddFeedback, setShowAddFeedback] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [inAppNotification, setInAppNotification] = useState<{title: string, body: string} | null>(null);

  // Check if user is logged in
  useEffect(() => {
    const user = localStorage.getItem('current_user');
    if (user) {
      setCurrentUser(JSON.parse(user));
    }
  }, []);

  // Show permission modal on first load
  useEffect(() => {
    if (!currentUser) return;
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
  }, [currentUser]);

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

  const handleLogout = () => {
    localStorage.removeItem('current_user');
    setCurrentUser(null);
  };

  // Load data
  useEffect(() => {
    if (!currentUser) return;
    setClients(getClients().filter(c => c.userId === currentUser.id));
    setReminders(getReminders().filter(r => r.userId === currentUser.id));
    setProperties(getProperties().filter(p => p.userId === currentUser.id));
    setDailyFeedbacks(getDailyFeedbacks().filter(f => f.userId === currentUser.id));
  }, [currentUser]);

  // Check reminders every 5 seconds
  useEffect(() => {
    if (!currentUser) return;
    const checkReminders = () => {
      const currentReminders = getReminders().filter(r => r.userId === currentUser.id);
      const notifiedIds = getNotifiedReminders();
      
      currentReminders.forEach(reminder => {
        if (isReminderDue(reminder) && !reminder.isCompleted && !notifiedIds.includes(reminder.id)) {
          addNotifiedReminder(reminder.id);
          if (soundEnabled) playNotificationSound();
          vibrateDevice();
          sendNotification(
            '⏰ تذكير بالاتصال بعميل',
            `حان وقت الاتصال بـ ${reminder.clientName}\n${reminder.clientPhone}`,
            `reminder-${reminder.id}`
          );
          setInAppNotification({
            title: `⏰ حان وقت الاتصال بـ ${reminder.clientName}`,
            body: `${reminder.clientPhone} - ${reminder.note || 'تذكير بمكالمة'}`
          });
          setTimeout(() => setInAppNotification(null), 10000);
        }
      });
    };

    checkReminders();
    const interval = setInterval(checkReminders, 5000);
    return () => clearInterval(interval);
  }, [currentUser, soundEnabled]);

  const addClient = useCallback((client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'userId'>) => {
    if (!currentUser) return;
    const newClient: Client = {
      ...client,
      userId: currentUser.id,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newClient, ...clients];
    setClients(updated);
    const allClients = getClients();
    saveClients([newClient, ...allClients]);
    setShowAddClient(false);
  }, [clients, currentUser]);

  const updateClient = useCallback((id: string,  Partial<Client>) => {
    const updated = clients.map(c => 
      c.id === id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c
    );
    setClients(updated);
    const allClients = getClients();
    saveClients(allClients.map(c => c.id === id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c));
    setSelectedClient(null);
  }, [clients]);

  const deleteClient = useCallback((id: string) => {
    const updated = clients.filter(c => c.id !== id);
    setClients(updated);
    saveClients(getClients().filter(c => c.id !== id));
    setReminders(reminders.filter(r => r.clientId !== id));
    saveReminders(getReminders().filter(r => r.clientId !== id));
  }, [clients, reminders]);

  const addReminder = useCallback((reminder: Omit<Reminder, 'id' | 'isCompleted' | 'isDelayed' | 'delayCount' | 'createdAt' | 'userId'>) => {
    if (!currentUser) return;
    const newReminder: Reminder = {
      ...reminder,
      userId: currentUser.id,
      id: crypto.randomUUID(),
      isCompleted: false,
      isDelayed: false,
      delayCount: 0,
      createdAt: new Date().toISOString(),
    };
    const updated = [newReminder, ...reminders];
    setReminders(updated);
    saveReminders([newReminder, ...getReminders()]);
    setShowAddReminder(false);
  }, [reminders, currentUser]);

  const completeReminder = useCallback((id: string) => {
    const updated = reminders.map(r => r.id === id ? { ...r, isCompleted: true } : r);
    setReminders(updated);
    saveReminders(getReminders().map(r => r.id === id ? { ...r, isCompleted: true } : r));
  }, [reminders]);

  const delayReminder = useCallback((id: string, minutes: number) => {
    const updated = reminders.map(r => {
      if (r.id === id) {
        const newTime = new Date(new Date(r.dateTime).getTime() + minutes * 60000);
        return { ...r, dateTime: newTime.toISOString(), isDelayed: true, delayCount: r.delayCount + 1 };
      }
      return r;
    });
    setReminders(updated);
    saveReminders(getReminders().map(r => {
      if (r.id === id) {
        const newTime = new Date(new Date(r.dateTime).getTime() + minutes * 60000);
        return { ...r, dateTime: newTime.toISOString(), isDelayed: true, delayCount: r.delayCount + 1 };
      }
      return r;
    }));
    const notified = getNotifiedReminders().filter(nid => nid !== id);
    localStorage.setItem('crm_notified_reminders', JSON.stringify(notified));
  }, [reminders]);

  const deleteReminder = useCallback((id: string) => {
    const updated = reminders.filter(r => r.id !== id);
    setReminders(updated);
    saveReminders(getReminders().filter(r => r.id !== id));
  }, [reminders]);

  const addProperty = useCallback((property: Omit<Property, 'id' | 'createdAt' | 'userId'>) => {
    if (!currentUser) return;
    const newProperty: Property = {
      ...property,
      userId: currentUser.id,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newProperty, ...properties];
    setProperties(updated);
    saveProperties([newProperty, ...getProperties()]);
    setShowAddProperty(false);
  }, [properties, currentUser]);

  const deleteProperty = useCallback((id: string) => {
    const updated = properties.filter(p => p.id !== id);
    setProperties(updated);
    saveProperties(getProperties().filter(p => p.id !== id));
  }, [properties]);

  const filteredClients = clients.filter(c => 
    c.name.includes(searchTerm) || 
    c.phone.includes(searchTerm) || 
    c.property.includes(searchTerm)
  );

  const filteredProperties = properties.filter(p => {
    const searchLower = propertySearch.toLowerCase();
    const searchNumeric = parsePrice(propertySearch);
    
    // Search in text fields
    const textMatch = p.name.toLowerCase().includes(searchLower) ||
                     p.type.toLowerCase().includes(searchLower) ||
                     p.location.toLowerCase().includes(searchLower) ||
                     p.description.toLowerCase().includes(searchLower);
    
    // Search in price (both numeric and text)
    const priceMatch = p.price.toLowerCase().includes(searchLower) ||
                      p.priceNumeric === searchNumeric ||
                      (searchNumeric > 0 && Math.abs(p.priceNumeric - searchNumeric) < 1000);
    
    return textMatch || priceMatch;
  });

  const activeReminders = reminders.filter(r => !r.isCompleted);
  const dueReminders = reminders.filter(r => isReminderDue(r));
  
  const stats = {
    totalClients: clients.length,
    activeReminders: activeReminders.length,
    dueNow: dueReminders.length,
    campaignClients: clients.filter(c => c.status === 'campaign').length,
    facebookClients: clients.filter(c => c.status === 'facebook').length,
    externalClients: clients.filter(c => c.status === 'external').length,
    newStage: clients.filter(c => c.stage === 'new').length,
    contactedStage: clients.filter(c => c.stage === 'contacted').length,
    meetingStage: clients.filter(c => c.stage === 'meeting').length,
    negotiationStage: clients.filter(c => c.stage === 'negotiation').length,
    closedStage: clients.filter(c => c.stage === 'closed').length,
    lostStage: clients.filter(c => c.stage === 'lost').length,
    totalProperties: properties.length,
  };

  if (!currentUser) {
    return <LoginScreen onLogin={setCurrentUser} />;
  }

  return (
    <div className="min-h-screen bg-[#030014] text-white relative overflow-hidden">
      <div className="bg-orb bg-orb-1"></div>
      <div className="bg-orb bg-orb-2"></div>
      <div className="bg-orb bg-orb-3"></div>

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
                <button onClick={() => setInAppNotification(null)} className="p-1 hover:bg-white/10 rounded-lg">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="relative z-10 glass-card border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
            <motion.div whileHover={{ rotate: 360, scale: 1.1 }} transition={{ duration: 0.6 }}
              className="w-12 h-12 gradient-primary rounded-xl flex items-center justify-center shadow-lg glow-primary">
              <Building2 className="w-7 h-7 text-white" />
            </motion.div>
            <div>
              <h1 className="text-xl font-bold gradient-text">Muhammed CRM</h1>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-400" />
                نظام CRM الخاص بمحمد - مرحباً {currentUser.name}
              </p>
            </div>
          </motion.div>
          
          <div className="flex items-center gap-3">
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${soundEnabled ? 'bg-purple-500/20 text-purple-400' : 'bg-white/5 text-gray-500'}`}>
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </motion.button>

            {!notificationPermission && (
              <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} whileHover={{ scale: 1.05 }}
                onClick={() => setShowPermissionModal(true)}
                className="flex items-center gap-2 bg-purple-500/20 text-purple-300 px-3 py-2 rounded-lg text-sm border border-purple-500/30">
                <Bell className="w-4 h-4" />
                <span className="hidden sm:inline">تفعيل الإشعارات</span>
              </motion.button>
            )}
            
            <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }}
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={() => setActiveTab('reminders')}
              className="relative p-2 bg-purple-500/20 rounded-lg hover:bg-purple-500/30 transition-colors"
              title="التذكيرات">
              <Bell className="w-6 h-6 text-purple-400" />
              {stats.dueNow > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold animate-pulse">
                  {stats.dueNow}
                </span>
              )}
            </motion.button>
            
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setShowAddClient(true)}
              className="gradient-primary text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover">
              <Plus className="w-4 h-4" />
              عميل جديد
            </motion.button>

            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={handleLogout}
              className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
              title="تسجيل الخروج">
              <LogOut className="w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </header>

      <nav className="relative z-10 glass-card border-b border-purple-500/10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {[
              { id: 'dashboard' as TabType, icon: Home, label: 'الرئيسية' },
              { id: 'clients' as TabType, icon: Users, label: 'العملاء' },
              { id: 'pipeline' as TabType, icon: Target, label: 'المراحل' },
              { id: 'properties' as TabType, icon: Building2, label: 'العقارات' },
              { id: 'reminders' as TabType, icon: Bell, label: 'التذكيرات' },
              { id: 'daily-feedback' as TabType, icon: MessageSquare, label: 'الفيدباك' },
              { id: 'reports' as TabType, icon: BarChart3, label: 'التقارير' },
            ].map((tab, i) => (
              <motion.button key={tab.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all duration-300 border-b-2 whitespace-nowrap relative ${
                  activeTab === tab.id ? 'border-purple-400 text-purple-300' : 'border-transparent text-gray-400 hover:text-purple-300'
                }`}>
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'reminders' && stats.dueNow > 0 && (
                  <span className="w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center text-white animate-pulse">
                    {stats.dueNow}
                  </span>
                )}
                {activeTab === tab.id && (
                  <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 gradient-primary" />
                )}
              </motion.button>
            ))}
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <DashboardView stats={stats} clients={clients} reminders={reminders} properties={properties}
                onComplete={completeReminder} onDelay={delayReminder} />
            </motion.div>
          )}

          {activeTab === 'clients' && (
            <motion.div key="clients" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <ClientsView clients={filteredClients} searchTerm={searchTerm} onSearch={setSearchTerm}
                onSelect={setSelectedClient} onDelete={deleteClient} onAdd={() => setShowAddClient(true)} />
            </motion.div>
          )}

          {activeTab === 'pipeline' && (
            <motion.div key="pipeline" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <PipelineView clients={clients} onUpdateStage={(id, stage) => updateClient(id, { stage })} />
            </motion.div>
          )}

          {activeTab === 'properties' && (
            <motion.div key="properties" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <PropertiesView properties={filteredProperties} searchTerm={propertySearch} onSearch={setPropertySearch}
                onSelect={setSelectedProperty} onDelete={deleteProperty} onAdd={() => setShowAddProperty(true)} />
            </motion.div>
          )}

          {activeTab === 'reminders' && (
            <motion.div key="reminders" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <RemindersView reminders={reminders} onComplete={completeReminder} onDelay={delayReminder}
                onDelete={deleteReminder} onAdd={() => setShowAddReminder(true)} />
            </motion.div>
          )}

          {activeTab === 'daily-feedback' && (
            <motion.div key="daily-feedback" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <DailyFeedbackView feedbacks={dailyFeedbacks} clients={clients}
                onDelete={(id) => {
                  const updated = dailyFeedbacks.filter(f => f.id !== id);
                  setDailyFeedbacks(updated);
                  saveDailyFeedbacks(getDailyFeedbacks().filter(f => f.id !== id));
                }}
                onAdd={() => setShowAddFeedback(true)} />
            </motion.div>
          )}

          {activeTab === 'reports' && (
            <motion.div key="reports" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <ReportsView stats={stats} clients={clients} properties={properties} feedbacks={dailyFeedbacks} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showPermissionModal && <PermissionModal onAllow={handlePermissionRequest} onDeny={handleDenyPermission} />}
        {showAddClient && <AddClientModal onClose={() => setShowAddClient(false)} onAdd={addClient} />}
        {showAddReminder && <AddReminderModal clients={clients} onClose={() => setShowAddReminder(false)} onAdd={addReminder} />}
        {selectedClient && (
          <ClientDetailModal client={selectedClient} onClose={() => setSelectedClient(null)}
            onUpdate={updateClient} onDelete={() => { deleteClient(selectedClient.id); setSelectedClient(null); }}
            onAddReminder={() => { setSelectedClient(null); setShowAddReminder(true); }} />
        )}
        {showAddProperty && <AddPropertyModal clients={clients} onClose={() => setShowAddProperty(false)} onAdd={addProperty} />}
        {selectedProperty && (
          <PropertyDetailModal property={selectedProperty} onClose={() => setSelectedProperty(null)}
            onDelete={() => { deleteProperty(selectedProperty.id); setSelectedProperty(null); }} />
        )}
        {showAddFeedback && (
          <AddFeedbackModal clients={clients} onClose={() => setShowAddFeedback(false)}
            onAdd={(feedback) => {
              if (!currentUser) return;
              const newFeedback: DailyFeedback = {
                ...feedback,
                userId: currentUser.id,
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
              };
              const updated = [newFeedback, ...dailyFeedbacks];
              setDailyFeedbacks(updated);
              saveDailyFeedbacks([newFeedback, ...getDailyFeedbacks()]);
              setShowAddFeedback(false);
            }} />
        )}
      </AnimatePresence>
    </div>
  );
}

// Login Screen
function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', name: '' });
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const users: User[] = JSON.parse(localStorage.getItem('crm_users') || '[]');

    if (isRegister) {
      if (!form.username || !form.password || !form.name) {
        setError('يرجى ملء جميع الحقول');
        return;
      }
      if (users.find(u => u.username === form.username)) {
        setError('اسم المستخدم موجود بالفعل');
        return;
      }
      const newUser: User = {
        id: crypto.randomUUID(),
        username: form.username,
        password: form.password,
        name: form.name,
        role: 'sales',
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem('crm_users', JSON.stringify([...users, newUser]));
      localStorage.setItem('current_user', JSON.stringify(newUser));
      onLogin(newUser);
    } else {
      const user = users.find(u => u.username === form.username && u.password === form.password);
      if (!user) {
        setError('اسم المستخدم أو كلمة المرور غير صحيحة');
        return;
      }
      localStorage.setItem('current_user', JSON.stringify(user));
      onLogin(user);
    }
  };

  return (
    <div className="min-h-screen bg-[#030014] flex items-center justify-center p-4">
      <div className="bg-orb bg-orb-1"></div>
      <div className="bg-orb bg-orb-2"></div>
      
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card rounded-3xl p-8 w-full max-w-md border-purple-400/30 glow-primary"
      >
        <div className="text-center mb-8">
          <motion.div
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 2, repeat: Infinity, repeatType: "reverse" }}
            className="w-20 h-20 gradient-primary rounded-full flex items-center justify-center mx-auto mb-4 glow-primary"
          >
            <Building2 className="w-10 h-10 text-white" />
          </motion.div>
          <h1 className="text-3xl font-bold gradient-text mb-2">Muhammed CRM</h1>
          <p className="text-gray-400">نظام CRM الخاص بمحمد</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="block text-sm text-gray-300 mb-1">الاسم الكامل</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
                placeholder="اسمك الكامل"
              />
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-300 mb-1">اسم المستخدم</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="اسم المستخدم"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">كلمة المرور</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="كلمة المرور"
            />
          </div>

          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm text-center">
              {error}
            </motion.p>
          )}

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            className="w-full gradient-primary text-white py-3 rounded-xl font-bold text-lg shadow-lg glow-primary btn-hover"
          >
            {isRegister ? 'إنشاء حساب' : 'تسجيل الدخول'}
          </motion.button>

          <p className="text-center text-gray-400 text-sm">
            {isRegister ? 'لديك حساب بالفعل؟' : 'ليس لديك حساب؟'}
            <button type="button" onClick={() => setIsRegister(!isRegister)} className="text-purple-400 mr-1 hover:underline">
              {isRegister ? 'تسجيل الدخول' : 'إنشاء حساب'}
            </button>
          </p>
        </form>
      </motion.div>
    </div>
  );
}

// Permission Modal
function PermissionModal({ onAllow, onDeny }: { onAllow: () => void; onDeny: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}
        transition={{ type: "spring", duration: 0.6 }}
        className="glass-card rounded-3xl p-8 w-full max-w-md border-purple-400/30 glow-primary text-center">
        <motion.div animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="w-20 h-20 gradient-primary rounded-full flex items-center justify-center mx-auto mb-6 glow-primary">
          <Bell className="w-10 h-10 text-white" />
        </motion.div>
        <h2 className="text-2xl font-bold gradient-text mb-3">تفعيل الإشعارات والصوت</h2>
        <p className="text-gray-300 mb-2">هل تريد تفعيل الإشعارات والصوت؟</p>
        <p className="text-gray-400 text-sm mb-6">سنرسل لك إشعارات مع صوت عند حلول وقت الاتصال بالعملاء</p>
        <div className="flex gap-3">
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAllow}
            className="flex-1 gradient-primary text-white py-3 rounded-xl font-bold btn-hover glow-primary">
            <span className="flex items-center justify-center gap-2"><Check className="w-5 h-5" /> السماح</span>
          </motion.button>
          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onDeny}
            className="flex-1 bg-white/10 text-white py-3 rounded-xl font-bold hover:bg-white/20 transition-colors border border-white/10">
            لاحقاً
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Dashboard View
function DashboardView({ stats, clients, reminders, properties, onComplete, onDelay }: {
  stats: any; clients: Client[]; reminders: Reminder[]; properties: Property[];
  onComplete: (id: string) => void; onDelay: (id: string, minutes: number) => void;
}) {
  const dueReminders = reminders.filter(r => isReminderDue(r) && !r.isCompleted);
  
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10">
          <div className="absolute top-0 right-0 w-40 h-40 gradient-primary rounded-full blur-3xl animate-float"></div>
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }}></div>
        </div>
        <div className="relative z-10">
          <h2 className="text-2xl font-bold gradient-text mb-2">مرحباً بك 👋</h2>
          <p className="text-gray-300">إليك نظرة عامة على نشاطك اليوم</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'إجمالي العملاء', value: stats.totalClients, icon: Users, gradient: 'from-purple-500 to-violet-600' },
          { label: 'عملاء كامبين', value: stats.campaignClients, icon: UserPlus, gradient: 'from-violet-500 to-purple-600' },
          { label: 'عملاء فيسبوك', value: stats.facebookClients, icon: Star, gradient: 'from-emerald-500 to-purple-500' },
          { label: 'عملاء خارجي', value: stats.externalClients, icon: Award, gradient: 'from-purple-500 to-pink-500' },
          { label: 'العقارات', value: stats.totalProperties, icon: Building2, gradient: 'from-cyan-500 to-purple-500' },
          { label: 'مستحقة الآن', value: stats.dueNow, icon: Zap, gradient: 'from-amber-500 to-purple-500' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.1, type: "spring" }}
            whileHover={{ scale: 1.05, y: -5 }} className="glass-card rounded-2xl p-4 card-hover">
            <motion.div whileHover={{ rotate: 360 }} transition={{ duration: 0.5 }}
              className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-3 shadow-lg`}>
              <stat.icon className="w-6 h-6 text-white" />
            </motion.div>
            <p className="text-3xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {dueReminders.length > 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-2xl p-6 border-red-500/30" style={{ boxShadow: '0 0 30px rgba(239, 68, 68, 0.2)' }}>
          <div className="flex items-center gap-3 mb-4">
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1, repeat: Infinity }}
              className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </motion.div>
            <div>
              <h3 className="text-lg font-bold text-red-400">⚠️ تذكيرات مستحقة الآن</h3>
              <p className="text-sm text-gray-400">يجب الاتصال بهذه العملاء فوراً</p>
            </div>
          </div>
          <div className="space-y-3">
            {dueReminders.map((reminder, i) => (
              <motion.div key={reminder.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }} whileHover={{ scale: 1.01 }}
                className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-bold text-white text-lg">{reminder.clientName}</p>
                  <p className="text-sm text-gray-400" dir="ltr">{reminder.clientPhone}</p>
                </div>
                <div className="flex items-center gap-2">
                  <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    onClick={() => onComplete(reminder.id)}
                    className="p-2.5 bg-emerald-500/20 rounded-xl hover:bg-emerald-500/30 transition-colors">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </motion.button>
                  <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    onClick={() => onDelay(reminder.id, 30)}
                    className="p-2.5 bg-amber-500/20 rounded-xl hover:bg-amber-500/30 transition-colors">
                    <Clock className="w-5 h-5 text-amber-400" />
                  </motion.button>
                  <motion.a whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    href={`tel:${reminder.clientPhone}`}
                    className="p-2.5 bg-purple-500/20 rounded-xl hover:bg-purple-500/30 transition-colors">
                    <PhoneCall className="w-5 h-5 text-purple-400" />
                  </motion.a>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Pipeline View
function PipelineView({ clients, onUpdateStage }: { clients: Client[]; onUpdateStage: (id: string, stage: Client['stage']) => void }) {
  const stages = [
    { id: 'new', label: 'جديد', color: 'from-blue-500 to-blue-600', icon: '🆕' },
    { id: 'contacted', label: 'تم التواصل', color: 'from-purple-500 to-purple-600', icon: '📞' },
    { id: 'meeting', label: 'موعد معاينة', color: 'from-cyan-500 to-cyan-600', icon: '📅' },
    { id: 'negotiation', label: 'تفاوض', color: 'from-amber-500 to-amber-600', icon: '💬' },
    { id: 'closed', label: 'تم البيع', color: 'from-emerald-500 to-emerald-600', icon: '✅' },
    { id: 'lost', label: 'ضائع', color: 'from-red-500 to-red-600', icon: '❌' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
        <Target className="w-6 h-6" />
        مراحل العملاء (Pipeline)
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {stages.map((stage, i) => {
          const stageClients = clients.filter(c => c.stage === stage.id);
          return (
            <motion.div key={stage.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }} className="glass-card rounded-2xl p-4">
              <div className={`bg-gradient-to-r ${stage.color} rounded-xl p-3 mb-3`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{stage.icon}</span>
                    <h3 className="font-bold text-white">{stage.label}</h3>
                  </div>
                  <span className="bg-white/20 text-white px-2 py-1 rounded-full text-sm font-bold">
                    {stageClients.length}
                  </span>
                </div>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {stageClients.map((client) => (
                  <motion.div key={client.id} whileHover={{ scale: 1.02 }}
                    className="bg-white/5 rounded-lg p-3 hover:bg-white/10 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-white text-sm">{client.name}</p>
                        <p className="text-xs text-gray-400" dir="ltr">{client.phone}</p>
                      </div>
                    </div>
                    {client.property && <p className="text-xs text-purple-400 mb-2">{client.property}</p>}
                    <div className="flex gap-1">
                      {stages.map((s) => (
                        <button key={s.id} onClick={() => onUpdateStage(client.id, s.id as Client['stage'])}
                          className={`flex-1 text-xs py-1 rounded ${
                            client.stage === s.id ? 'bg-purple-500 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'
                          }`} title={s.label}>
                          {s.icon}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                ))}
                {stageClients.length === 0 && <p className="text-center text-gray-500 text-xs py-4">لا يوجد عملاء</p>}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// Properties View with Smart Search
function PropertiesView({ properties, searchTerm, onSearch, onSelect, onDelete, onAdd }: {
  properties: Property[]; searchTerm: string; onSearch: (term: string) => void;
  onSelect: (property: Property) => void; onDelete: (id: string) => void; onAdd: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="بحث ذكي: اسم، نوع، موقع، أو سعر (مثل: مليون، 1000000، 1,000,000)..."
            value={searchTerm} onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl pr-11 pl-4 py-3 text-white placeholder-gray-500 focus:border-purple-500/50 transition-all" />
        </motion.div>
        <motion.button initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAdd}
          className="gradient-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg glow-primary btn-hover">
          <Plus className="w-5 h-5" />
          إضافة عقار
        </motion.button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {properties.map((property, i) => (
          <motion.div key={property.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }} whileHover={{ scale: 1.02, y: -5 }}
            onClick={() => onSelect(property)}
            className="glass-card rounded-2xl p-5 cursor-pointer card-hover animated-border">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <motion.div whileHover={{ scale: 1.2, rotate: 360 }} transition={{ duration: 0.5 }}
                  className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center shadow-lg">
                  <Building2 className="w-6 h-6 text-white" />
                </motion.div>
                <div>
                  <h4 className="font-bold text-white">{property.name}</h4>
                  <p className="text-sm text-gray-400">{property.type}</p>
                </div>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-gray-300 flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-400" />
                المساحة: {property.area}
              </p>
              <p className="text-gray-300 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-purple-400" />
                السعر: <span className="font-bold text-purple-400">{formatPrice(property.price)}</span>
              </p>
              <p className="text-gray-300 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-purple-400" />
                الموقع: {property.location}
              </p>
              {property.clientName && (
                <p className="text-gray-300 flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-400" />
                  العميل: {property.clientName}
                </p>
              )}
              {property.clientPhone && (
                <p className="text-gray-300 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-purple-400" />
                  <span dir="ltr">{property.clientPhone}</span>
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </div>
      
      {properties.length === 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-16">
          <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <Building2 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          </motion.div>
          <p className="text-gray-400 text-lg">لا يوجد عقارات</p>
          <p className="text-gray-500 text-sm mt-2">اضغط على "إضافة عقار" لبدء إضافة عقاراتك</p>
        </motion.div>
      )}
    </div>
  );
}

// Clients View
function ClientsView({ clients, searchTerm, onSearch, onSelect, onDelete, onAdd }: {
  clients: Client[]; searchTerm: string; onSearch: (term: string) => void;
  onSelect: (client: Client) => void; onDelete: (id: string) => void; onAdd: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="بحث بالاسم أو رقم الهاتف أو العقار..."
            value={searchTerm} onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl pr-11 pl-4 py-3 text-white placeholder-gray-500 focus:border-purple-500/50 transition-all" />
        </motion.div>
        <motion.button initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAdd}
          className="gradient-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg glow-primary btn-hover">
          <Plus className="w-5 h-5" />
          إضافة عميل
        </motion.button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {clients.map((client, i) => (
          <motion.div key={client.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }} whileHover={{ scale: 1.02, y: -5 }}
            onClick={() => onSelect(client)}
            className="glass-card rounded-2xl p-5 cursor-pointer card-hover animated-border">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <motion.div whileHover={{ scale: 1.2, rotate: 360 }} transition={{ duration: 0.5 }}
                  className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center shadow-lg">
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
              <div className="flex gap-2">
                <StatusBadge status={client.status} />
                <StageBadge stage={client.stage} />
              </div>
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
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-16">
          <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          </motion.div>
          <p className="text-gray-400 text-lg">لا يوجد عملاء</p>
        </motion.div>
      )}
    </div>
  );
}

// Reminders View
function RemindersView({ reminders, onComplete, onDelay, onDelete, onAdd }: {
  reminders: Reminder[]; onComplete: (id: string) => void; onDelay: (id: string, minutes: number) => void;
  onDelete: (id: string) => void; onAdd: () => void;
}) {
  const pending = reminders.filter(r => !r.isCompleted);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
          <Bell className="w-6 h-6" />
          التذكيرات
        </h2>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAdd}
          className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover">
          <Plus className="w-4 h-4" />
          تذكير جديد
        </motion.button>
      </div>

      {pending.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-400">التذكيرات القادمة ({pending.length})</h3>
          {pending.map((reminder, i) => {
            const isDue = isReminderDue(reminder);
            return (
              <motion.div key={reminder.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }} whileHover={{ scale: 1.01 }}
                className={`glass-card rounded-2xl p-4 ${isDue ? 'border-red-500/50' : ''}`}
                style={isDue ? { boxShadow: '0 0 20px rgba(239, 68, 68, 0.3)' } : {}}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-bold text-white text-lg">{reminder.clientName}</h4>
                      {isDue && (
                        <motion.span animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1, repeat: Infinity }}
                          className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
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
                  </div>
                  <div className="flex items-center gap-1.5 mr-4">
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                      onClick={() => onComplete(reminder.id)}
                      className="p-2 bg-emerald-500/20 rounded-lg hover:bg-emerald-500/30 transition-colors">
                      <Check className="w-4 h-4 text-emerald-400" />
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                      onClick={() => onDelay(reminder.id, 30)}
                      className="p-2 bg-amber-500/20 rounded-lg hover:bg-amber-500/30 transition-colors">
                      <Clock className="w-4 h-4 text-amber-400" />
                    </motion.button>
                    <motion.a whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                      href={`tel:${reminder.clientPhone}`}
                      className="p-2 bg-purple-500/20 rounded-lg hover:bg-purple-500/30 transition-colors">
                      <PhoneCall className="w-4 h-4 text-purple-400" />
                    </motion.a>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                      onClick={() => onDelete(reminder.id)}
                      className="p-2 bg-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {reminders.length === 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-16">
          <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <Bell className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          </motion.div>
          <p className="text-gray-400 text-lg">لا يوجد تذكيرات</p>
        </motion.div>
      )}
    </div>
  );
}

// Daily Feedback View
function DailyFeedbackView({ feedbacks, clients, onDelete, onAdd }: {
  feedbacks: DailyFeedback[]; clients: Client[]; onDelete: (id: string) => void; onAdd: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
          <MessageSquare className="w-6 h-6" />
          الفيدباك اليومي
        </h2>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAdd}
          className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover">
          <Plus className="w-4 h-4" />
          إضافة فيدباك
        </motion.button>
      </div>

      <div className="space-y-3">
        {feedbacks.map((feedback, i) => (
          <motion.div key={feedback.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }} className="glass-card rounded-2xl p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="font-bold text-white text-lg">{feedback.clientName}</h4>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    feedback.callStatus === 'called' ? 'bg-emerald-500/20 text-emerald-400' :
                    feedback.callStatus === 'no-answer' ? 'bg-amber-500/20 text-amber-400' :
                    feedback.callStatus === 'busy' ? 'bg-red-500/20 text-red-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {feedback.callStatus === 'called' ? 'تم الاتصال' :
                     feedback.callStatus === 'no-answer' ? 'لا رد' :
                     feedback.callStatus === 'busy' ? 'مشغول' : 'لم يتصل'}
                  </span>
                </div>
                <p className="text-sm text-purple-400 flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  <span dir="ltr">{feedback.clientPhone}</span>
                </p>
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDateTime(feedback.date)}
                </p>
                {feedback.feedback && (
                  <p className="text-sm text-gray-300 mt-2 bg-white/5 rounded-lg p-2">{feedback.feedback}</p>
                )}
              </div>
              <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                onClick={() => onDelete(feedback.id)}
                className="p-2 bg-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors">
                <Trash2 className="w-4 h-4 text-red-400" />
              </motion.button>
            </div>
          </motion.div>
        ))}
      </div>

      {feedbacks.length === 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-16">
          <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <MessageSquare className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          </motion.div>
          <p className="text-gray-400 text-lg">لا يوجد فيدباك يومي</p>
        </motion.div>
      )}
    </div>
  );
}

// Reports View
function ReportsView({ stats, clients, properties, feedbacks }: {
  stats: any; clients: Client[]; properties: Property[]; feedbacks: DailyFeedback[];
}) {
  const conversionRate = clients.length > 0 ? ((stats.closedStage / clients.length) * 100).toFixed(1) : 0;
  const calledToday = feedbacks.filter(f => {
    const today = new Date().toDateString();
    return new Date(f.date).toDateString() === today && f.callStatus === 'called';
  }).length;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
        <BarChart3 className="w-6 h-6" />
        التقارير والإحصائيات
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{conversionRate}%</p>
              <p className="text-sm text-gray-400">نسبة التحويل</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center">
              <PhoneCall className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{calledToday}</p>
              <p className="text-sm text-gray-400">مكالمات اليوم</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-cyan-600 rounded-xl flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{properties.length}</p>
              <p className="text-sm text-gray-400">إجمالي العقارات</p>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{stats.negotiationStage}</p>
              <p className="text-sm text-gray-400">في مرحلة التفاوض</p>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold gradient-text mb-4 flex items-center gap-2">
            <PieChart className="w-5 h-5" />
            توزيع المصادر
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-300">كامبين</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 rounded-full" style={{ width: `${clients.length > 0 ? (stats.campaignClients / clients.length) * 100 : 0}%` }}></div>
                </div>
                <span className="text-white font-bold">{stats.campaignClients}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300">فيسبوك</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${clients.length > 0 ? (stats.facebookClients / clients.length) * 100 : 0}%` }}></div>
                </div>
                <span className="text-white font-bold">{stats.facebookClients}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300">خارجي</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${clients.length > 0 ? (stats.externalClients / clients.length) * 100 : 0}%` }}></div>
                </div>
                <span className="text-white font-bold">{stats.externalClients}</span>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
          className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold gradient-text mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            ملخص المراحل
          </h3>
          <div className="space-y-2">
            {[
              { label: 'جديد', count: stats.newStage, color: 'bg-blue-500' },
              { label: 'تم التواصل', count: stats.contactedStage, color: 'bg-purple-500' },
              { label: 'موعد معاينة', count: stats.meetingStage, color: 'bg-cyan-500' },
              { label: 'تفاوض', count: stats.negotiationStage, color: 'bg-amber-500' },
              { label: 'تم البيع', count: stats.closedStage, color: 'bg-emerald-500' },
              { label: 'ضائع', count: stats.lostStage, color: 'bg-red-500' },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-gray-300 text-sm">{item.label}</span>
                <span className="text-white font-bold">{item.count}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Status Badge
function StatusBadge({ status }: { status: Client['status'] }) {
  const getStatusInfo = () => {
    switch (status) {
      case 'campaign': return { label: 'كامبين', className: 'status-new' };
      case 'facebook': return { label: 'فيسبوك', className: 'status-contacted' };
      case 'external': return { label: 'خارجي', className: 'status-interested' };
      default: return { label: 'غير معروف', className: 'status-new' };
    }
  };
  const { label, className } = getStatusInfo();
  return <span className={`text-xs px-2.5 py-1 rounded-full ${className}`}>{label}</span>;
}

// Stage Badge
function StageBadge({ stage }: { stage: Client['stage'] }) {
  const getStageInfo = () => {
    switch (stage) {
      case 'new': return { label: 'جديد', className: 'bg-blue-500/20 text-blue-400' };
      case 'contacted': return { label: 'تم التواصل', className: 'bg-purple-500/20 text-purple-400' };
      case 'meeting': return { label: 'موعد معاينة', className: 'bg-cyan-500/20 text-cyan-400' };
      case 'negotiation': return { label: 'تفاوض', className: 'bg-amber-500/20 text-amber-400' };
      case 'closed': return { label: 'تم البيع', className: 'bg-emerald-500/20 text-emerald-400' };
      case 'lost': return { label: 'ضائع', className: 'bg-red-500/20 text-red-400' };
      default: return { label: 'غير معروف', className: 'bg-gray-500/20 text-gray-400' };
    }
  };
  const { label, className } = getStageInfo();
  return <span className={`text-xs px-2.5 py-1 rounded-full ${className}`}>{label}</span>;
}

export default App;
