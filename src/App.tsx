import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Bell, Plus, Home, Phone, Clock, Check, 
  AlertTriangle, Star, Calendar, 
  MessageSquare, X, Edit3, Trash2, Search,
  PhoneCall, UserPlus, Building2, Sparkles,
  Zap, Target, Award, Volume2, VolumeX,
  LogOut, TrendingUp, DollarSign,
  BarChart3, PieChart, Activity, FileText,
  Shield, Settings, Lock
} from 'lucide-react';
import { Client, Reminder, Property, DailyFeedback, User, Team, TabType } from './types';

// ============ Database (localStorage) ============
const DB = {
  getUsers: (): User[] => JSON.parse(localStorage.getItem('crm_users') || '[]'),
  saveUsers: (users: User[]) => localStorage.setItem('crm_users', JSON.stringify(users)),
  getClients: (): Client[] => JSON.parse(localStorage.getItem('crm_clients') || '[]'),
  saveClients: (clients: Client[]) => localStorage.setItem('crm_clients', JSON.stringify(clients)),
  getReminders: (): Reminder[] => JSON.parse(localStorage.getItem('crm_reminders') || '[]'),
  saveReminders: (r: Reminder[]) => localStorage.setItem('crm_reminders', JSON.stringify(r)),
  getProperties: (): Property[] => JSON.parse(localStorage.getItem('crm_properties') || '[]'),
  saveProperties: (p: Property[]) => localStorage.setItem('crm_properties', JSON.stringify(p)),
  getFeedbacks: (): DailyFeedback[] => JSON.parse(localStorage.getItem('crm_feedbacks') || '[]'),
  saveFeedbacks: (f: DailyFeedback[]) => localStorage.setItem('crm_feedbacks', JSON.stringify(f)),
  getTeams: (): Team[] => JSON.parse(localStorage.getItem('crm_teams') || '[]'),
  saveTeams: (t: Team[]) => localStorage.setItem('crm_teams', JSON.stringify(t)),
  getCurrentUser: (): User | null => {
    const data = localStorage.getItem('crm_current_user');
    return data ? JSON.parse(data) : null;
  },
  setCurrentUser: (user: User | null) => {
    if (user) localStorage.setItem('crm_current_user', JSON.stringify(user));
    else localStorage.removeItem('crm_current_user');
  },
};

// Initialize admin account on first load
const initializeDB = () => {
  const users = DB.getUsers();
  if (users.length === 0) {
    const admin: User = {
      id: 'admin-001',
      username: 'admin',
      password: 'admin123',
      name: 'المدير العام',
      phone: '',
      role: 'admin',
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: 'system',
    };
    DB.saveUsers([admin]);
  }
};

// ============ Helper Functions ============
const formatPrice = (price: string): string => {
  if (!price) return '0';
  const cleanPrice = price.replace(/[,\s]/g, '');
  const num = parseFloat(cleanPrice);
  if (isNaN(num)) return price;
  return num.toLocaleString('en-US');
};

const parsePrice = (price: string): number => {
  if (!price) return 0;
  const arabicNumbers: Record<string, number> = {
    'مليون': 1000000, 'مليونين': 2000000, 'مليوني': 2000000,
    'الف': 1000, 'ألف': 1000, 'الفين': 2000, 'ألفين': 2000,
    'مليار': 1000000000, 'نص مليون': 500000, 'نصف مليون': 500000,
  };
  const lowerPrice = price.toLowerCase().trim();
  for (const [word, value] of Object.entries(arabicNumbers)) {
    if (lowerPrice.includes(word)) {
      const match = lowerPrice.match(/(\d+\.?\d*)\s*[\*×x]?\s*[\u0600-\u06FF]+/);
      if (match) return parseFloat(match[1]) * value;
      return value;
    }
  }
  const cleanPrice = price.replace(/[,\s$€£ج.م]/g, '');
  const num = parseFloat(cleanPrice);
  return isNaN(num) ? 0 : num;
};

const formatDateTime = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

// ============ Main App ============
function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  
  useEffect(() => {
    initializeDB();
    const user = DB.getCurrentUser();
    if (user) setCurrentUser(user);
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    DB.setCurrentUser(user);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    DB.setCurrentUser(null);
  };

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <MainApp 
      currentUser={currentUser} 
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onLogout={handleLogout}
    />
  );
}

// ============ Login Screen ============
function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const users = DB.getUsers();
    const user = users.find(u => 
      u.username === form.username && 
      u.password === form.password && 
      u.isActive
    );
    if (!user) {
      setError('اسم المستخدم أو كلمة المرور غير صحيحة');
      return;
    }
    onLogin(user);
  };

  return (
    <div className="min-h-screen bg-[#030014] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="bg-orb bg-orb-1"></div>
      <div className="bg-orb bg-orb-2"></div>
      
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card rounded-3xl p-8 w-full max-w-md border-purple-400/30 glow-primary relative z-10"
      >
        <div className="text-center mb-8">
          <motion.div
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 3, repeat: Infinity, repeatType: "reverse" }}
            className="w-20 h-20 gradient-primary rounded-full flex items-center justify-center mx-auto mb-4 glow-primary"
          >
            <Building2 className="w-10 h-10 text-white" />
          </motion.div>
          <h1 className="text-3xl font-bold gradient-text mb-2">Muhammed CRM</h1>
          <p className="text-gray-400 flex items-center justify-center gap-2">
            <Lock className="w-4 h-4" />
            نظام CRM الخاص بمحمد
          </p>
          <p className="text-xs text-gray-500 mt-2">تسجيل دخول خاص بالإدارة والفريق</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-2">اسم المستخدم</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="أدخل اسم المستخدم"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">كلمة المرور</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="أدخل كلمة المرور"
            />
          </div>

          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm text-center bg-red-500/10 p-2 rounded-lg">
              {error}
            </motion.p>
          )}

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            className="w-full gradient-primary text-white py-3 rounded-xl font-bold text-lg shadow-lg glow-primary btn-hover"
          >
            تسجيل الدخول
          </motion.button>
        </form>

        <div className="mt-6 p-3 bg-purple-500/10 rounded-xl border border-purple-500/20">
          <p className="text-xs text-gray-400 text-center">
            <Shield className="w-3 h-3 inline ml-1" />
            الحسابات يتم إنشاؤها من قبل الإدارة فقط
          </p>
          <p className="text-xs text-gray-500 text-center mt-1">
            الحساب الافتراضي: admin / admin123
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// ============ Main App (After Login) ============
function MainApp({ currentUser, activeTab, setActiveTab, onLogout }: {
  currentUser: User;
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onLogout: () => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [feedbacks, setFeedbacks] = useState<DailyFeedback[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showAddFeedback, setShowAddFeedback] = useState(false);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Load data based on role
  useEffect(() => {
    const allClients = DB.getClients();
    const allReminders = DB.getReminders();
    const allProperties = DB.getProperties();
    const allFeedbacks = DB.getFeedbacks();
    const allUsers = DB.getUsers();
    const allTeams = DB.getTeams();

    if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
      // Admin/Supervisor sees all data
      setClients(allClients);
      setReminders(allReminders);
      setProperties(allProperties);
      setFeedbacks(allFeedbacks);
    } else {
      // Sales sees only their own data
      setClients(allClients.filter(c => c.ownerId === currentUser.id || c.assignedTo === currentUser.id));
      setReminders(allReminders.filter(r => r.ownerId === currentUser.id));
      setProperties(allProperties.filter(p => p.ownerId === currentUser.id));
      setFeedbacks(allFeedbacks.filter(f => f.ownerId === currentUser.id));
    }

    setUsers(allUsers);
    setTeams(allTeams);
  }, [currentUser]);

  // Stats
  const stats = {
    totalClients: clients.length,
    campaignClients: clients.filter(c => c.source === 'campaign').length,
    facebookClients: clients.filter(c => c.source === 'facebook').length,
    externalClients: clients.filter(c => c.source === 'external').length,
    newStage: clients.filter(c => c.stage === 'new').length,
    contactedStage: clients.filter(c => c.stage === 'contacted').length,
    meetingStage: clients.filter(c => c.stage === 'meeting').length,
    negotiationStage: clients.filter(c => c.stage === 'negotiation').length,
    closedStage: clients.filter(c => c.stage === 'closed').length,
    lostStage: clients.filter(c => c.stage === 'lost').length,
    totalProperties: properties.length,
    totalUsers: users.length,
    activeReminders: reminders.filter(r => !r.isCompleted).length,
    dueNow: reminders.filter(r => !r.isCompleted && new Date(r.dateTime) <= new Date()).length,
  };

  const filteredClients = clients.filter(c => 
    c.name.includes(searchTerm) || c.phone.includes(searchTerm) || c.property.includes(searchTerm)
  );

  const filteredProperties = properties.filter(p => {
    const searchLower = propertySearch.toLowerCase();
    const searchNumeric = parsePrice(propertySearch);
    const textMatch = p.name.toLowerCase().includes(searchLower) ||
                     p.type.toLowerCase().includes(searchLower) ||
                     p.location.toLowerCase().includes(searchLower);
    const priceMatch = p.price.toLowerCase().includes(searchLower) ||
                      p.priceNumeric === searchNumeric;
    return textMatch || priceMatch;
  });

  // Client CRUD
  const addClient = (client: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'ownerId'>) => {
    const newClient: Client = {
      ...client,
      ownerId: currentUser.id,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [newClient, ...DB.getClients()];
    DB.saveClients(updated);
    setClients(currentUser.role === 'sales' 
      ? updated.filter(c => c.ownerId === currentUser.id || c.assignedTo === currentUser.id)
      : updated);
    setShowAddClient(false);
  };

  const updateClient = (id: string,  Partial<Client>) => {
    const all = DB.getClients().map(c => 
      c.id === id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c
    );
    DB.saveClients(all);
    setClients(currentUser.role === 'sales'
      ? all.filter(c => c.ownerId === currentUser.id || c.assignedTo === currentUser.id)
      : all);
    setSelectedClient(null);
  };

  const deleteClient = (id: string) => {
    const all = DB.getClients().filter(c => c.id !== id);
    DB.saveClients(all);
    setClients(currentUser.role === 'sales'
      ? all.filter(c => c.ownerId === currentUser.id || c.assignedTo === currentUser.id)
      : all);
  };

  // Reminder CRUD
  const addReminder = (reminder: Omit<Reminder, 'id' | 'createdAt' | 'ownerId' | 'isCompleted' | 'isDelayed' | 'delayCount'>) => {
    const newReminder: Reminder = {
      ...reminder,
      ownerId: currentUser.id,
      id: crypto.randomUUID(),
      isCompleted: false,
      isDelayed: false,
      delayCount: 0,
      createdAt: new Date().toISOString(),
    };
    const updated = [newReminder, ...DB.getReminders()];
    DB.saveReminders(updated);
    setReminders(currentUser.role === 'sales'
      ? updated.filter(r => r.ownerId === currentUser.id)
      : updated);
    setShowAddReminder(false);
  };

  const completeReminder = (id: string) => {
    const updated = DB.getReminders().map(r => r.id === id ? { ...r, isCompleted: true } : r);
    DB.saveReminders(updated);
    setReminders(currentUser.role === 'sales'
      ? updated.filter(r => r.ownerId === currentUser.id)
      : updated);
  };

  const delayReminder = (id: string, minutes: number) => {
    const updated = DB.getReminders().map(r => {
      if (r.id === id) {
        const newTime = new Date(new Date(r.dateTime).getTime() + minutes * 60000);
        return { ...r, dateTime: newTime.toISOString(), isDelayed: true, delayCount: r.delayCount + 1 };
      }
      return r;
    });
    DB.saveReminders(updated);
    setReminders(currentUser.role === 'sales'
      ? updated.filter(r => r.ownerId === currentUser.id)
      : updated);
  };

  const deleteReminder = (id: string) => {
    const updated = DB.getReminders().filter(r => r.id !== id);
    DB.saveReminders(updated);
    setReminders(currentUser.role === 'sales'
      ? updated.filter(r => r.ownerId === currentUser.id)
      : updated);
  };

  // Property CRUD
  const addProperty = (property: Omit<Property, 'id' | 'createdAt' | 'ownerId'>) => {
    const newProperty: Property = {
      ...property,
      ownerId: currentUser.id,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newProperty, ...DB.getProperties()];
    DB.saveProperties(updated);
    setProperties(currentUser.role === 'sales'
      ? updated.filter(p => p.ownerId === currentUser.id)
      : updated);
    setShowAddProperty(false);
  };

  const deleteProperty = (id: string) => {
    const updated = DB.getProperties().filter(p => p.id !== id);
    DB.saveProperties(updated);
    setProperties(currentUser.role === 'sales'
      ? updated.filter(p => p.ownerId === currentUser.id)
      : updated);
  };

  // Feedback CRUD
  const addFeedback = (feedback: Omit<DailyFeedback, 'id' | 'createdAt' | 'ownerId'>) => {
    const newFeedback: DailyFeedback = {
      ...feedback,
      ownerId: currentUser.id,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newFeedback, ...DB.getFeedbacks()];
    DB.saveFeedbacks(updated);
    setFeedbacks(currentUser.role === 'sales'
      ? updated.filter(f => f.ownerId === currentUser.id)
      : updated);
    setShowAddFeedback(false);
  };

  const deleteFeedback = (id: string) => {
    const updated = DB.getFeedbacks().filter(f => f.id !== id);
    DB.saveFeedbacks(updated);
    setFeedbacks(currentUser.role === 'sales'
      ? updated.filter(f => f.ownerId === currentUser.id)
      : updated);
  };

  // User Management (Admin/Supervisor only)
  const createUser = (userData: { username: string; password: string; name: string; phone: string; role: User['role'] }) => {
    const newUser: User = {
      ...userData,
      id: crypto.randomUUID(),
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
    };
    const updated = [...DB.getUsers(), newUser];
    DB.saveUsers(updated);
    setUsers(updated);
    setShowCreateAccount(false);
  };

  const updateUser = (id: string,  Partial<User>) => {
    const updated = DB.getUsers().map(u => u.id === id ? { ...u, ...data } : u);
    DB.saveUsers(updated);
    setUsers(updated);
    setSelectedUser(null);
  };

  const deleteUser = (id: string) => {
    const updated = DB.getUsers().filter(u => u.id !== id);
    DB.saveUsers(updated);
    setUsers(updated);
    setSelectedUser(null);
  };

  // Assign client to user
  const assignClient = (clientId: string, userId: string) => {
    const updated = DB.getClients().map(c => 
      c.id === clientId ? { ...c, assignedTo: userId, updatedAt: new Date().toISOString() } : c
    );
    DB.saveClients(updated);
    setClients(currentUser.role === 'sales'
      ? updated.filter(c => c.ownerId === currentUser.id || c.assignedTo === currentUser.id)
      : updated);
  };

  const isManager = currentUser.role === 'admin' || currentUser.role === 'supervisor';

  return (
    <div className="min-h-screen bg-[#030014] text-white relative overflow-hidden">
      <div className="bg-orb bg-orb-1"></div>
      <div className="bg-orb bg-orb-2"></div>
      <div className="bg-orb bg-orb-3"></div>

      {/* Header */}
      <header className="relative z-10 glass-card border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div whileHover={{ rotate: 360, scale: 1.1 }} transition={{ duration: 0.6 }}
              className="w-12 h-12 gradient-primary rounded-xl flex items-center justify-center shadow-lg glow-primary">
              <Building2 className="w-7 h-7 text-white" />
            </motion.div>
            <div>
              <h1 className="text-xl font-bold gradient-text">Muhammed CRM</h1>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Shield className="w-3 h-3 text-purple-400" />
                {currentUser.name} • {currentUser.role === 'admin' ? 'مدير' : currentUser.role === 'supervisor' ? 'مشرف' : 'بائع'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${soundEnabled ? 'bg-purple-500/20 text-purple-400' : 'bg-white/5 text-gray-500'}`}>
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </motion.button>

            {isManager && (
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setShowCreateAccount(true)}
                className="bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors">
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">إنشاء حساب</span>
              </motion.button>
            )}
            
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setShowAddClient(true)}
              className="gradient-primary text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover">
              <Plus className="w-4 h-4" />
              عميل جديد
            </motion.button>

            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={onLogout}
              className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
              title="تسجيل الخروج">
              <LogOut className="w-5 h-5" />
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
              { id: 'pipeline' as TabType, icon: Target, label: 'المراحل' },
              { id: 'properties' as TabType, icon: Building2, label: 'العقارات' },
              { id: 'reminders' as TabType, icon: Bell, label: 'التذكيرات' },
              { id: 'daily-feedback' as TabType, icon: MessageSquare, label: 'الفيدباك' },
              { id: 'reports' as TabType, icon: BarChart3, label: 'التقارير' },
              ...(isManager ? [{ id: 'admin-panel' as TabType, icon: Shield, label: 'لوحة الإدارة' }] : []),
            ].map((tab, i) => (
              <motion.button key={tab.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-300 border-b-2 whitespace-nowrap relative ${
                  activeTab === tab.id ? 'border-purple-400 text-purple-300' : 'border-transparent text-gray-400 hover:text-purple-300'
                }`}>
                <tab.icon className="w-4 h-4" />
                <span className="hidden md:inline">{tab.label}</span>
                {tab.id === 'reminders' && stats.dueNow > 0 && (
                  <span className="w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center text-white animate-pulse">
                    {stats.dueNow}
                  </span>
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
            <motion.div key="dashboard" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <DashboardView stats={stats} reminders={reminders} onComplete={completeReminder} onDelay={delayReminder} />
            </motion.div>
          )}
          {activeTab === 'clients' && (
            <motion.div key="clients" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <ClientsView clients={filteredClients} searchTerm={searchTerm} onSearch={setSearchTerm}
                onSelect={setSelectedClient} onDelete={deleteClient} onAdd={() => setShowAddClient(true)}
                isManager={isManager} users={users} onAssign={assignClient} currentUser={currentUser} />
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
              <DailyFeedbackView feedbacks={feedbacks} clients={clients} onDelete={deleteFeedback} onAdd={() => setShowAddFeedback(true)} />
            </motion.div>
          )}
          {activeTab === 'reports' && (
            <motion.div key="reports" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <ReportsView stats={stats} clients={clients} properties={properties} feedbacks={feedbacks} users={users} />
            </motion.div>
          )}
          {activeTab === 'admin-panel' && isManager && (
            <motion.div key="admin-panel" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <AdminPanel 
                users={users} 
                currentUser={currentUser}
                onSelect={setSelectedUser}
                onAdd={() => setShowCreateAccount(true)}
                stats={stats}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showAddClient && <AddClientModal onClose={() => setShowAddClient(false)} onAdd={addClient} />}
        {showAddReminder && <AddReminderModal clients={clients} onClose={() => setShowAddReminder(false)} onAdd={addReminder} />}
        {showAddProperty && <AddPropertyModal clients={clients} onClose={() => setShowAddProperty(false)} onAdd={addProperty} />}
        {showAddFeedback && <AddFeedbackModal clients={clients} onClose={() => setShowAddFeedback(false)} onAdd={addFeedback} />}
        {showCreateAccount && isManager && <CreateAccountModal onClose={() => setShowCreateAccount(false)} onCreate={createUser} />}
        {selectedClient && (
          <ClientDetailModal client={selectedClient} onClose={() => setSelectedClient(null)}
            onUpdate={updateClient} onDelete={() => { deleteClient(selectedClient.id); setSelectedClient(null); }}
            onAddReminder={() => { setSelectedClient(null); setShowAddReminder(true); }} />
        )}
        {selectedProperty && (
          <PropertyDetailModal property={selectedProperty} onClose={() => setSelectedProperty(null)}
            onDelete={() => { deleteProperty(selectedProperty.id); setSelectedProperty(null); }} />
        )}
        {selectedUser && isManager && (
          <UserDetailModal user={selectedUser} currentUser={currentUser}
            onClose={() => setSelectedUser(null)} onUpdate={updateUser} onDelete={deleteUser} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============ Dashboard ============
function DashboardView({ stats, reminders, onComplete, onDelay }: any) {
  const dueReminders = reminders.filter((r: Reminder) => !r.isCompleted && new Date(r.dateTime) <= new Date());
  
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10">
          <div className="absolute top-0 right-0 w-40 h-40 gradient-primary rounded-full blur-3xl animate-float"></div>
        </div>
        <div className="relative z-10">
          <h2 className="text-2xl font-bold gradient-text mb-2">مرحباً بك 👋</h2>
          <p className="text-gray-300">إليك نظرة عامة على نشاطك اليوم</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'إجمالي العملاء', value: stats.totalClients, icon: Users, gradient: 'from-purple-500 to-violet-600' },
          { label: 'كامبين', value: stats.campaignClients, icon: UserPlus, gradient: 'from-violet-500 to-purple-600' },
          { label: 'فيسبوك', value: stats.facebookClients, icon: Star, gradient: 'from-emerald-500 to-purple-500' },
          { label: 'خارجي', value: stats.externalClients, icon: Award, gradient: 'from-purple-500 to-pink-500' },
          { label: 'العقارات', value: stats.totalProperties, icon: Building2, gradient: 'from-cyan-500 to-purple-500' },
          { label: 'مستحقة الآن', value: stats.dueNow, icon: Zap, gradient: 'from-amber-500 to-red-500' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.1, type: "spring" }}
            whileHover={{ scale: 1.05, y: -5 }} className="glass-card rounded-2xl p-4 card-hover">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-3 shadow-lg`}>
              <stat.icon className="w-6 h-6 text-white" />
            </div>
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
            {dueReminders.map((reminder: Reminder) => (
              <motion.div key={reminder.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }}
                whileHover={{ scale: 1.01 }}
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

// ============ Clients View ============
function ClientsView({ clients, searchTerm, onSearch, onSelect, onDelete, onAdd, isManager, users, onAssign, currentUser }: any) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="بحث بالاسم أو رقم الهاتف أو العقار..."
            value={searchTerm} onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl pr-11 pl-4 py-3 text-white placeholder-gray-500 focus:border-purple-500/50 transition-all" />
        </div>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAdd}
          className="gradient-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg glow-primary btn-hover">
          <Plus className="w-5 h-5" /> إضافة عميل
        </motion.button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {clients.map((client: Client, i: number) => {
          const owner = users?.find((u: User) => u.id === client.ownerId);
          const assigned = client.assignedTo ? users?.find((u: User) => u.id === client.assignedTo) : null;
          
          return (
            <motion.div key={client.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }} whileHover={{ scale: 1.02, y: -5 }}
              onClick={() => onSelect(client)}
              className="glass-card rounded-2xl p-5 cursor-pointer card-hover animated-border">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center shadow-lg">
                    <span className="text-white font-bold">{client.name[0]}</span>
                  </div>
                  <div>
                    <h4 className="font-bold text-white">{client.name}</h4>
                    <p className="text-sm text-gray-400 flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      <span dir="ltr">{client.phone}</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <SourceBadge source={client.source} />
                  <StageBadge stage={client.stage} />
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <p className="text-gray-300 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-purple-400" />
                  {client.property || 'لم يحدد العقار'}
                </p>
                {isManager && owner && (
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    المالك: {owner.name}
                    {assigned && ` • مُسند إلى: ${assigned.name}`}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
      
      {clients.length === 0 && (
        <div className="text-center py-16">
          <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">لا يوجد عملاء</p>
        </div>
      )}
    </div>
  );
}

// ============ Pipeline View ============
function PipelineView({ clients, onUpdateStage }: any) {
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
          const stageClients = clients.filter((c: Client) => c.stage === stage.id);
          return (
            <motion.div key={stage.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }} className="glass-card rounded-2xl p-4">
              <div className={`bg-gradient-to-r ${stage.color} rounded-xl p-3 mb-3`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{stage.icon}</span>
                    <h3 className="font-bold text-white text-sm">{stage.label}</h3>
                  </div>
                  <span className="bg-white/20 text-white px-2 py-1 rounded-full text-sm font-bold">
                    {stageClients.length}
                  </span>
                </div>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {stageClients.map((client: Client) => (
                  <motion.div key={client.id} whileHover={{ scale: 1.02 }}
                    className="bg-white/5 rounded-lg p-3 hover:bg-white/10 transition-colors">
                    <p className="font-medium text-white text-sm">{client.name}</p>
                    <p className="text-xs text-gray-400" dir="ltr">{client.phone}</p>
                    {client.property && <p className="text-xs text-purple-400 mt-1">{client.property}</p>}
                    <div className="flex gap-1 mt-2">
                      {stages.map((s) => (
                        <button key={s.id} onClick={() => onUpdateStage(client.id, s.id)}
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

// ============ Properties View ============
function PropertiesView({ properties, searchTerm, onSearch, onSelect, onDelete, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="بحث ذكي: اسم، نوع، موقع، أو سعر (مثل: مليون، 1000000)..."
            value={searchTerm} onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl pr-11 pl-4 py-3 text-white placeholder-gray-500 focus:border-purple-500/50 transition-all" />
        </div>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAdd}
          className="gradient-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg glow-primary btn-hover">
          <Plus className="w-5 h-5" /> إضافة عقار
        </motion.button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {properties.map((property: Property, i: number) => (
          <motion.div key={property.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }} whileHover={{ scale: 1.02, y: -5 }}
            onClick={() => onSelect(property)}
            className="glass-card rounded-2xl p-5 cursor-pointer card-hover animated-border">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center shadow-lg">
                  <Building2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h4 className="font-bold text-white">{property.name}</h4>
                  <p className="text-sm text-gray-400">{property.type}</p>
                </div>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-gray-300 flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-400" /> المساحة: {property.area}
              </p>
              <p className="text-gray-300 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-purple-400" />
                السعر: <span className="font-bold text-purple-400">{formatPrice(property.price)}</span>
              </p>
              <p className="text-gray-300 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-purple-400" /> الموقع: {property.location}
              </p>
              {property.clientName && (
                <p className="text-gray-300 flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-400" /> العميل: {property.clientName}
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </div>
      
      {properties.length === 0 && (
        <div className="text-center py-16">
          <Building2 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">لا يوجد عقارات</p>
        </div>
      )}
    </div>
  );
}

// ============ Reminders View ============
function RemindersView({ reminders, onComplete, onDelay, onDelete, onAdd }: any) {
  const pending = reminders.filter((r: Reminder) => !r.isCompleted);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
          <Bell className="w-6 h-6" /> التذكيرات
        </h2>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAdd}
          className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover">
          <Plus className="w-4 h-4" /> تذكير جديد
        </motion.button>
      </div>

      <div className="space-y-3">
        {pending.map((reminder: Reminder, i: number) => {
          const isDue = new Date(reminder.dateTime) <= new Date();
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
                    <Phone className="w-3 h-3" /> <span dir="ltr">{reminder.clientPhone}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> {formatDateTime(reminder.dateTime)}
                  </p>
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

      {reminders.length === 0 && (
        <div className="text-center py-16">
          <Bell className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">لا يوجد تذكيرات</p>
        </div>
      )}
    </div>
  );
}

// ============ Daily Feedback View ============
function DailyFeedbackView({ feedbacks, clients, onDelete, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
          <MessageSquare className="w-6 h-6" /> الفيدباك اليومي
        </h2>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAdd}
          className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover">
          <Plus className="w-4 h-4" /> إضافة فيدباك
        </motion.button>
      </div>

      <div className="space-y-3">
        {feedbacks.map((feedback: DailyFeedback, i: number) => (
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
                  <Phone className="w-3 h-3" /> <span dir="ltr">{feedback.clientPhone}</span>
                </p>
                <p className="text-xs text-gray-400 mt-1">{formatDateTime(feedback.date)}</p>
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
        <div className="text-center py-16">
          <MessageSquare className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">لا يوجد فيدباك يومي</p>
        </div>
      )}
    </div>
  );
}

// ============ Reports View ============
function ReportsView({ stats, clients, properties, feedbacks, users }: any) {
  const conversionRate = clients.length > 0 ? ((stats.closedStage / clients.length) * 100).toFixed(1) : 0;
  const calledToday = feedbacks.filter((f: DailyFeedback) => {
    const today = new Date().toDateString();
    return new Date(f.date).toDateString() === today && f.callStatus === 'called';
  }).length;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
        <BarChart3 className="w-6 h-6" /> التقارير والإحصائيات
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'نسبة التحويل', value: `${conversionRate}%`, icon: TrendingUp, gradient: 'from-emerald-500 to-emerald-600' },
          { label: 'مكالمات اليوم', value: calledToday, icon: PhoneCall, gradient: 'from-purple-500 to-purple-600' },
          { label: 'إجمالي العقارات', value: properties.length, icon: Building2, gradient: 'from-cyan-500 to-cyan-600' },
          { label: 'في مرحلة التفاوض', value: stats.negotiationStage, icon: Activity, gradient: 'from-amber-500 to-amber-600' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }} className="glass-card rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-12 h-12 bg-gradient-to-br ${stat.gradient} rounded-xl flex items-center justify-center`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-3xl font-bold text-white">{stat.value}</p>
                <p className="text-sm text-gray-400">{stat.label}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
          className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold gradient-text mb-4 flex items-center gap-2">
            <PieChart className="w-5 h-5" /> توزيع المصادر
          </h3>
          <div className="space-y-3">
            {[
              { label: 'كامبين', count: stats.campaignClients, color: 'bg-purple-500' },
              { label: 'فيسبوك', count: stats.facebookClients, color: 'bg-blue-500' },
              { label: 'خارجي', count: stats.externalClients, color: 'bg-emerald-500' },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-gray-300">{item.label}</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className={`h-full ${item.color} rounded-full`} 
                      style={{ width: `${clients.length > 0 ? (item.count / clients.length) * 100 : 0}%` }}></div>
                  </div>
                  <span className="text-white font-bold">{item.count}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
          className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold gradient-text mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5" /> ملخص المراحل
          </h3>
          <div className="space-y-2">
            {[
              { label: 'جديد', count: stats.newStage },
              { label: 'تم التواصل', count: stats.contactedStage },
              { label: 'موعد معاينة', count: stats.meetingStage },
              { label: 'تفاوض', count: stats.negotiationStage },
              { label: 'تم البيع', count: stats.closedStage },
              { label: 'ضائع', count: stats.lostStage },
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

// ============ Admin Panel ============
function AdminPanel({ users, currentUser, onSelect, onAdd, stats }: any) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
          <Shield className="w-6 h-6" /> لوحة الإدارة
        </h2>
        <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onAdd}
          className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover">
          <UserPlus className="w-4 h-4" /> إنشاء حساب جديد
        </motion.button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4">
          <p className="text-3xl font-bold text-white">{users.length}</p>
          <p className="text-xs text-gray-400 mt-1">إجمالي المستخدمين</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass-card rounded-2xl p-4">
          <p className="text-3xl font-bold text-white">{users.filter((u: User) => u.role === 'sales').length}</p>
          <p className="text-xs text-gray-400 mt-1">البائعين</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card rounded-2xl p-4">
          <p className="text-3xl font-bold text-white">{stats.totalClients}</p>
          <p className="text-xs text-gray-400 mt-1">إجمالي العملاء</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="glass-card rounded-2xl p-4">
          <p className="text-3xl font-bold text-white">{stats.closedStage}</p>
          <p className="text-xs text-gray-400 mt-1">صفقات مغلقة</p>
        </motion.div>
      </div>

      {/* Users List */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-purple-400" /> المستخدمون
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          {users.map((user: User, i: number) => (
            <motion.div key={user.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }} whileHover={{ scale: 1.02 }}
              onClick={() => onSelect(user)}
              className="bg-white/5 rounded-xl p-4 cursor-pointer hover:bg-white/10 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 gradient-primary rounded-full flex items-center justify-center">
                  <span className="text-white font-bold">{user.name[0]}</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-white">{user.name}</h4>
                  <p className="text-xs text-gray-400">@{user.username}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full ${
                  user.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                  user.role === 'supervisor' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-blue-500/20 text-blue-400'
                }`}>
                  {user.role === 'admin' ? 'مدير' : user.role === 'supervisor' ? 'مشرف' : 'بائع'}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                <span>{user.isActive ? '✓ نشط' : '✗ معطل'}</span>
                <span>•</span>
                <span>{formatDateTime(user.createdAt).split(',')[0]}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ Modals ============

// Add Client Modal
function AddClientModal({ onClose, onAdd }: any) {
  const [form, setForm] = useState({
    name: '', phone: '', property: '', budget: '', monthlyInstallment: '',
    deliveryPeriod: '', source: 'campaign' as Client['source'],
    stage: 'new' as Client['stage'], feedback: '', priority: 'medium' as Client['priority'],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone) return;
    onAdd(form);
  };

  return (
    <ModalWrapper onClose={onClose} title="إضافة عميل جديد" icon={<UserPlus className="w-6 h-6" />}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <InputField label="الاسم *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <InputField label="رقم الهاتف *" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required dir="ltr" />
        <InputField label="العقار المطلوب" value={form.property} onChange={(v) => setForm({ ...form, property: v })} />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="الميزانية" value={form.budget} onChange={(v) => setForm({ ...form, budget: v })} />
          <InputField label="القسط الشهري" value={form.monthlyInstallment} onChange={(v) => setForm({ ...form, monthlyInstallment: v })} />
        </div>
        <InputField label="مدة الاستلام" value={form.deliveryPeriod} onChange={(v) => setForm({ ...form, deliveryPeriod: v })} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="المصدر" value={form.source} onChange={(v) => setForm({ ...form, source: v as Client['source'] })}
            options={[{ value: 'campaign', label: 'كامبين' }, { value: 'facebook', label: 'فيسبوك' }, { value: 'external', label: 'خارجي' }]} />
          <SelectField label="الأولوية" value={form.priority} onChange={(v) => setForm({ ...form, priority: v as Client['priority'] })}
            options={[{ value: 'high', label: 'عالية' }, { value: 'medium', label: 'متوسطة' }, { value: 'low', label: 'منخفضة' }]} />
        </div>
        <SelectField label="مرحلة العميل" value={form.stage} onChange={(v) => setForm({ ...form, stage: v as Client['stage'] })}
          options={[
            { value: 'new', label: 'جديد' }, { value: 'contacted', label: 'تم التواصل' },
            { value: 'meeting', label: 'موعد معاينة' }, { value: 'negotiation', label: 'تفاوض' },
            { value: 'closed', label: 'تم البيع' }, { value: 'lost', label: 'ضائع' },
          ]} />
        <TextareaField label="ملاحظات" value={form.feedback} onChange={(v) => setForm({ ...form, feedback: v })} />
        <SubmitButton>إضافة العميل ✨</SubmitButton>
      </form>
    </ModalWrapper>
  );
}

// Add Reminder Modal
function AddReminderModal({ clients, onClose, onAdd }: any) {
  const [form, setForm] = useState({ clientId: '', clientName: '', clientPhone: '', dateTime: '', note: '' });

  const handleClientSelect = (clientId: string) => {
    const client = clients.find((c: Client) => c.id === clientId);
    if (client) setForm({ ...form, clientId, clientName: client.name, clientPhone: client.phone });
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
    <ModalWrapper onClose={onClose} title="إضافة تذكير" icon={<Bell className="w-6 h-6" />}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {clients.length > 0 && (
          <div>
            <label className="block text-sm text-gray-300 mb-1">اختر عميل</label>
            <select value={form.clientId} onChange={(e) => handleClientSelect(e.target.value)}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all">
              <option value="" className="bg-gray-900">-- اختر عميل --</option>
              {clients.map((c: Client) => (<option key={c.id} value={c.id} className="bg-gray-900">{c.name} - {c.phone}</option>))}
            </select>
          </div>
        )}
        <InputField label="اسم العميل *" value={form.clientName} onChange={(v) => setForm({ ...form, clientName: v })} required />
        <InputField label="رقم الهاتف *" value={form.clientPhone} onChange={(v) => setForm({ ...form, clientPhone: v })} required dir="ltr" />
        <div>
          <label className="block text-sm text-gray-300 mb-1">وقت التذكير *</label>
          <input type="datetime-local" required min={minDateTime} value={form.dateTime} onChange={(e) => setForm({ ...form, dateTime: e.target.value })}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all" dir="ltr" />
        </div>
        <TextareaField label="ملاحظة" value={form.note} onChange={(v) => setForm({ ...form, note: v })} />
        <SubmitButton>إضافة التذكير 🔔</SubmitButton>
      </form>
    </ModalWrapper>
  );
}

// Add Property Modal
function AddPropertyModal({ clients, onClose, onAdd }: any) {
  const [form, setForm] = useState({
    name: '', type: '', area: '', price: '', priceNumeric: 0, location: '',
    description: '', clientPhone: '', clientName: '', project: '',
    rooms: '', bathrooms: '',
    finishing: 'fully-finished' as Property['finishing'],
    delivery: 'immediate' as Property['delivery'],
  });

  const handleClientSelect = (clientPhone: string) => {
    const client = clients.find((c: Client) => c.phone === clientPhone);
    if (client) setForm({ ...form, clientPhone, clientName: client.name });
    else setForm({ ...form, clientPhone, clientName: '' });
  };

  const handlePriceChange = (value: string) => {
    setForm({ ...form, price: value, priceNumeric: parsePrice(value) });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.type) return;
    onAdd({ ...form, priceNumeric: parsePrice(form.price) });
  };

  return (
    <ModalWrapper onClose={onClose} title="إضافة عقار جديد" icon={<Building2 className="w-6 h-6" />}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <InputField label="اسم العقار *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <SelectField label="نوع العقار *" value={form.type} onChange={(v) => setForm({ ...form, type: v })}
          options={[
            { value: 'شقة', label: 'شقة' }, { value: 'فيلا', label: 'فيلا' }, { value: 'أرض', label: 'أرض' },
            { value: 'محل', label: 'محل' }, { value: 'مكتب', label: 'مكتب' }, { value: 'دوبلكس', label: 'دوبلكس' },
            { value: 'بنتهاوس', label: 'بنتهاوس' }, { value: 'أخرى', label: 'أخرى' },
          ]} />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="المساحة" value={form.area} onChange={(v) => setForm({ ...form, area: v })} />
          <InputField label="السعر (رقم أو كلمة)" value={form.price} onChange={handlePriceChange} placeholder="مثل: مليون، 1,500,000" />
        </div>
        <InputField label="الموقع" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
        <div className="grid grid-cols-3 gap-3">
          <InputField label="الغرف" value={form.rooms} onChange={(v) => setForm({ ...form, rooms: v })} />
          <InputField label="الحمامات" value={form.bathrooms} onChange={(v) => setForm({ ...form, bathrooms: v })} />
          <InputField label="المشروع" value={form.project} onChange={(v) => setForm({ ...form, project: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="التشطيب" value={form.finishing} onChange={(v) => setForm({ ...form, finishing: v as Property['finishing'] })}
            options={[
              { value: 'fully-finished', label: 'سوبر لوكس' },
              { value: 'semi-finished', label: 'نصف تشطيب' },
              { value: 'core-and-shell', label: 'على المحارة' },
            ]} />
          <SelectField label="التسليم" value={form.delivery} onChange={(v) => setForm({ ...form, delivery: v as Property['delivery'] })}
            options={[{ value: 'immediate', label: 'فوري' }, { value: 'delayed', label: 'آجل' }]} />
        </div>
        <TextareaField label="الوصف" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
        <div>
          <label className="block text-sm text-gray-300 mb-1">رقم العميل (اختياري)</label>
          <input type="tel" list="property-client-phones" value={form.clientPhone} onChange={(e) => handleClientSelect(e.target.value)}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all" placeholder="05xxxxxxxx" dir="ltr" />
          <datalist id="property-client-phones">
            {clients.map((c: Client) => (<option key={c.id} value={c.phone}>{c.name}</option>))}
          </datalist>
        </div>
        <InputField label="اسم العميل" value={form.clientName} onChange={(v) => setForm({ ...form, clientName: v })} placeholder="يتعبأ تلقائياً" />
        <SubmitButton>إضافة العقار ✨</SubmitButton>
      </form>
    </ModalWrapper>
  );
}

// Add Feedback Modal
function AddFeedbackModal({ clients, onClose, onAdd }: any) {
  const [form, setForm] = useState({
    clientPhone: '', clientName: '', date: new Date().toISOString().slice(0, 16),
    feedback: '', callStatus: 'called' as DailyFeedback['callStatus'],
    duration: '', nextAction: '',
  });

  const handleClientSelect = (clientPhone: string) => {
    const client = clients.find((c: Client) => c.phone === clientPhone);
    if (client) setForm({ ...form, clientPhone, clientName: client.name });
    else setForm({ ...form, clientPhone, clientName: '' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientPhone || !form.clientName || !form.date) return;
    onAdd(form);
  };

  return (
    <ModalWrapper onClose={onClose} title="إضافة فيدباك يومي" icon={<MessageSquare className="w-6 h-6" />}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-300 mb-1">رقم العميل *</label>
          <input type="tel" required list="feedback-client-phones" value={form.clientPhone} onChange={(e) => handleClientSelect(e.target.value)}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all" placeholder="05xxxxxxxx" dir="ltr" />
          <datalist id="feedback-client-phones">
            {clients.map((c: Client) => (<option key={c.id} value={c.phone}>{c.name}</option>))}
          </datalist>
        </div>
        <InputField label="اسم العميل *" value={form.clientName} onChange={(v) => setForm({ ...form, clientName: v })} required />
        <div>
          <label className="block text-sm text-gray-300 mb-1">التاريخ والوقت *</label>
          <input type="datetime-local" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all" dir="ltr" />
        </div>
        <SelectField label="حالة الاتصال *" value={form.callStatus} onChange={(v) => setForm({ ...form, callStatus: v as DailyFeedback['callStatus'] })}
          options={[
            { value: 'called', label: 'تم الاتصال' }, { value: 'no-answer', label: 'لا رد' },
            { value: 'busy', label: 'مشغول' }, { value: 'not-called', label: 'لم يتصل' },
          ]} />
        <div className="grid grid-cols-2 gap-3">
          <InputField label="مدة المكالمة" value={form.duration} onChange={(v) => setForm({ ...form, duration: v })} />
          <InputField label="الإجراء التالي" value={form.nextAction} onChange={(v) => setForm({ ...form, nextAction: v })} />
        </div>
        <TextareaField label="الفيدباك" value={form.feedback} onChange={(v) => setForm({ ...form, feedback: v })} />
        <SubmitButton>إضافة الفيدباك 📝</SubmitButton>
      </form>
    </ModalWrapper>
  );
}

// Create Account Modal (Admin/Supervisor only)
function CreateAccountModal({ onClose, onCreate }: any) {
  const [form, setForm] = useState({
    username: '', password: '', name: '', phone: '', role: 'sales' as User['role'],
  });
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!form.username || !form.password || !form.name) {
      setError('يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    
    const users = DB.getUsers();
    if (users.find(u => u.username === form.username)) {
      setError('اسم المستخدم موجود بالفعل');
      return;
    }
    
    onCreate(form);
  };

  return (
    <ModalWrapper onClose={onClose} title="إنشاء حساب جديد" icon={<UserPlus className="w-6 h-6" />}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 mb-4">
          <p className="text-xs text-emerald-400 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            سيتم إنشاء حساب جديد بواسطة الإدارة
          </p>
        </div>
        
        <InputField label="الاسم الكامل *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <InputField label="اسم المستخدم *" value={form.username} onChange={(v) => setForm({ ...form, username: v })} required dir="ltr" />
        <InputField label="كلمة المرور *" value={form.password} onChange={(v) => setForm({ ...form, password: v })} required type="password" dir="ltr" />
        <InputField label="رقم الهاتف" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} dir="ltr" />
        <SelectField label="الدور *" value={form.role} onChange={(v) => setForm({ ...form, role: v as User['role'] })}
          options={[
            { value: 'sales', label: 'بائع' },
            { value: 'supervisor', label: 'مشرف' },
            { value: 'admin', label: 'مدير' },
          ]} />
        
        {error && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm text-center bg-red-500/10 p-2 rounded-lg">
            {error}
          </motion.p>
        )}
        
        <SubmitButton>إنشاء الحساب ✨</SubmitButton>
      </form>
    </ModalWrapper>
  );
}

// Client Detail Modal
function ClientDetailModal({ client, onClose, onUpdate, onDelete, onAddReminder }: any) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: client.name, phone: client.phone, property: client.property, budget: client.budget,
    monthlyInstallment: client.monthlyInstallment, deliveryPeriod: client.deliveryPeriod,
    source: client.source, stage: client.stage, feedback: client.feedback, priority: client.priority,
  });

  const handleSave = () => { onUpdate(client.id, form); setEditing(false); };

  return (
    <ModalWrapper onClose={onClose} title="تفاصيل العميل" icon={null}>
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 gradient-primary rounded-full flex items-center justify-center shadow-lg glow-primary">
          <span className="text-white font-bold text-2xl">{client.name[0]}</span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-white">{client.name}</h3>
          <div className="flex gap-2 mt-1">
            <SourceBadge source={client.source} />
            <StageBadge stage={client.stage} />
          </div>
        </div>
      </div>
      {editing ? (
        <div className="space-y-4">
          <InputField label="الاسم" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <InputField label="الهاتف" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} dir="ltr" />
          <InputField label="العقار" value={form.property} onChange={(v) => setForm({ ...form, property: v })} />
          <div className="grid grid-cols-2 gap-3">
            <InputField label="الميزانية" value={form.budget} onChange={(v) => setForm({ ...form, budget: v })} />
            <InputField label="القسط" value={form.monthlyInstallment} onChange={(v) => setForm({ ...form, monthlyInstallment: v })} />
          </div>
          <InputField label="مدة الاستلام" value={form.deliveryPeriod} onChange={(v) => setForm({ ...form, deliveryPeriod: v })} />
          <SelectField label="المرحلة" value={form.stage} onChange={(v) => setForm({ ...form, stage: v as Client['stage'] })}
            options={[
              { value: 'new', label: 'جديد' }, { value: 'contacted', label: 'تم التواصل' },
              { value: 'meeting', label: 'موعد معاينة' }, { value: 'negotiation', label: 'تفاوض' },
              { value: 'closed', label: 'تم البيع' }, { value: 'lost', label: 'ضائع' },
            ]} />
          <TextareaField label="ملاحظات" value={form.feedback} onChange={(v) => setForm({ ...form, feedback: v })} />
          <div className="flex gap-3">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleSave}
              className="flex-1 gradient-primary text-white py-3 rounded-xl font-bold btn-hover">حفظ ✓</motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setEditing(false)}
              className="flex-1 bg-white/10 text-white py-3 rounded-xl font-bold hover:bg-white/20 transition-colors">إلغاء</motion.button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label="الهاتف" value={client.phone} dir="ltr" />
            <InfoCard label="العقار" value={client.property || '-'} />
            <InfoCard label="الميزانية" value={client.budget || '-'} />
            <InfoCard label="القسط الشهري" value={client.monthlyInstallment || '-'} />
            <InfoCard label="مدة الاستلام" value={client.deliveryPeriod || '-'} />
            <InfoCard label="المصدر" value={client.source === 'campaign' ? 'كامبين' : client.source === 'facebook' ? 'فيسبوك' : 'خارجي'} />
          </div>
          {client.feedback && (
            <div className="bg-white/5 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">ملاحظات</p>
              <p className="text-white text-sm">{client.feedback}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <ActionButton icon={<Edit3 className="w-4 h-4" />} label="تعديل" onClick={() => setEditing(true)} color="purple" />
            <ActionButton icon={<PhoneCall className="w-4 h-4" />} label="اتصال" href={`tel:${client.phone}`} color="emerald" />
            <ActionButton icon={<Bell className="w-4 h-4" />} label="تذكير" onClick={onAddReminder} color="amber" />
            <ActionButton icon={<Trash2 className="w-4 h-4" />} label="" onClick={onDelete} color="red" />
          </div>
        </div>
      )}
    </ModalWrapper>
  );
}

// Property Detail Modal
function PropertyDetailModal({ property, onClose, onDelete }: any) {
  return (
    <ModalWrapper onClose={onClose} title="تفاصيل العقار" icon={null}>
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 gradient-primary rounded-full flex items-center justify-center shadow-lg glow-primary">
          <Building2 className="w-8 h-8 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white">{property.name}</h3>
          <p className="text-sm text-gray-400">{property.type}</p>
        </div>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="المساحة" value={property.area || '-'} />
          <InfoCard label="السعر" value={formatPrice(property.price)} highlight />
          <InfoCard label="الموقع" value={property.location || '-'} />
          <InfoCard label="الغرف / الحمامات" value={`${property.rooms || '-'} / ${property.bathrooms || '-'}`} />
          <InfoCard label="التشطيب" value={property.finishing === 'fully-finished' ? 'سوبر لوكس' : property.finishing === 'semi-finished' ? 'نصف تشطيب' : 'على المحارة'} />
          <InfoCard label="التسليم" value={property.delivery === 'immediate' ? 'فوري' : 'آجل'} />
        </div>
        {property.project && <InfoCard label="المشروع" value={property.project} />}
        {property.clientName && (
          <div className="bg-white/5 rounded-xl p-3">
            <p className="text-xs text-gray-400">العميل</p>
            <p className="text-white font-medium">{property.clientName}</p>
            {property.clientPhone && <p className="text-sm text-purple-400" dir="ltr">{property.clientPhone}</p>}
          </div>
        )}
        {property.description && (
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">الوصف</p>
            <p className="text-white text-sm">{property.description}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <ActionButton icon={<Trash2 className="w-4 h-4" />} label="حذف" onClick={onDelete} color="red" />
        </div>
      </div>
    </ModalWrapper>
  );
}

// User Detail Modal
function UserDetailModal({ user, currentUser, onClose, onUpdate, onDelete }: any) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: user.name, phone: user.phone || '', role: user.role, isActive: user.isActive,
  });

  const handleSave = () => { onUpdate(user.id, form); setEditing(false); };

  return (
    <ModalWrapper onClose={onClose} title="تفاصيل المستخدم" icon={null}>
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 gradient-primary rounded-full flex items-center justify-center shadow-lg glow-primary">
          <span className="text-white font-bold text-2xl">{user.name[0]}</span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-white">{user.name}</h3>
          <p className="text-sm text-gray-400">@{user.username}</p>
          <span className={`text-xs px-2.5 py-1 rounded-full mt-1 inline-block ${
            user.role === 'admin' ? 'bg-red-500/20 text-red-400' :
            user.role === 'supervisor' ? 'bg-amber-500/20 text-amber-400' :
            'bg-blue-500/20 text-blue-400'
          }`}>
            {user.role === 'admin' ? 'مدير' : user.role === 'supervisor' ? 'مشرف' : 'بائع'}
          </span>
        </div>
      </div>
      {editing ? (
        <div className="space-y-4">
          <InputField label="الاسم" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <InputField label="الهاتف" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} dir="ltr" />
          <SelectField label="الدور" value={form.role} onChange={(v) => setForm({ ...form, role: v as User['role'] })}
            options={[
              { value: 'sales', label: 'بائع' },
              { value: 'supervisor', label: 'مشرف' },
              { value: 'admin', label: 'مدير' },
            ]} />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="w-4 h-4 rounded" />
            <span className="text-white">نشط</span>
          </label>
          <div className="flex gap-3">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleSave}
              className="flex-1 gradient-primary text-white py-3 rounded-xl font-bold btn-hover">حفظ ✓</motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setEditing(false)}
              className="flex-1 bg-white/10 text-white py-3 rounded-xl font-bold hover:bg-white/20 transition-colors">إلغاء</motion.button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label="الهاتف" value={user.phone || '-'} dir="ltr" />
            <InfoCard label="الحالة" value={user.isActive ? '✓ نشط' : '✗ معطل'} />
            <InfoCard label="تاريخ الإنشاء" value={formatDateTime(user.createdAt).split(',')[0]} />
            <InfoCard label="الدور" value={user.role === 'admin' ? 'مدير' : user.role === 'supervisor' ? 'مشرف' : 'بائع'} />
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <ActionButton icon={<Edit3 className="w-4 h-4" />} label="تعديل" onClick={() => setEditing(true)} color="purple" />
            {user.id !== currentUser.id && (
              <ActionButton icon={<Trash2 className="w-4 h-4" />} label="حذف" onClick={() => onDelete(user.id)} color="red" />
            )}
          </div>
        </div>
      )}
    </ModalWrapper>
  );
}

// ============ Reusable Components ============

function ModalWrapper({ children, onClose, title, icon }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={onClose}>
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: "spring", duration: 0.5 }} onClick={(e) => e.stopPropagation()}
        className="glass-card rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border-purple-400/30 glow-primary">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
            {icon} {title}
          </h2>
          <motion.button whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }} onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </motion.button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function InputField({ label, value, onChange, required, type = 'text', dir, placeholder }: any) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">{label}</label>
      <input type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
        dir={dir} />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: any) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all">
        {options.map((opt: any) => (<option key={opt.value} value={opt.value} className="bg-gray-900">{opt.label}</option>))}
      </select>
    </div>
  );
}

function TextareaField({ label, value, onChange }: any) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all resize-none h-24" />
    </div>
  );
}

function SubmitButton({ children }: any) {
  return (
    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="submit"
      className="w-full gradient-primary text-white py-3 rounded-xl font-bold text-lg shadow-lg glow-primary btn-hover">
      {children}
    </motion.button>
  );
}

function InfoCard({ label, value, dir, highlight }: any) {
  return (
    <div className="bg-white/5 rounded-xl p-3 hover:bg-white/10 transition-colors">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`font-medium ${highlight ? 'text-purple-400' : 'text-white'}`} dir={dir}>{value}</p>
    </div>
  );
}

function ActionButton({ icon, label, onClick, href, color }: any) {
  const colorClasses = {
    purple: 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border-purple-500/20',
    emerald: 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border-emerald-500/20',
    amber: 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border-amber-500/20',
    red: 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/20',
  };
  
  const classes = `flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl transition-colors border ${colorClasses[color as keyof typeof colorClasses]}`;
  
  if (href) {
    return <motion.a whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} href={href} className={classes}>{icon} {label}</motion.a>;
  }
  return <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onClick} className={classes}>{icon} {label}</motion.button>;
}

function SourceBadge({ source }: { source: Client['source'] }) {
  const config = {
    campaign: { label: 'كامبين', class: 'status-new' },
    facebook: { label: 'فيسبوك', class: 'status-contacted' },
    external: { label: 'خارجي', class: 'status-interested' },
  };
  const { label, class: className } = config[source];
  return <span className={`text-xs px-2.5 py-1 rounded-full ${className}`}>{label}</span>;
}

function StageBadge({ stage }: { stage: Client['stage'] }) {
  const config = {
    new: { label: 'جديد', class: 'bg-blue-500/20 text-blue-400' },
    contacted: { label: 'تم التواصل', class: 'bg-purple-500/20 text-purple-400' },
    meeting: { label: 'موعد معاينة', class: 'bg-cyan-500/20 text-cyan-400' },
    negotiation: { label: 'تفاوض', class: 'bg-amber-500/20 text-amber-400' },
    closed: { label: 'تم البيع', class: 'bg-emerald-500/20 text-emerald-400' },
    lost: { label: 'ضائع', class: 'bg-red-500/20 text-red-400' },
  };
  const { label, class: className } = config[stage];
  return <span className={`text-xs px-2.5 py-1 rounded-full ${className}`}>{label}</span>;
}

export default App;
