import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, Bell, Plus, Home, Phone, Clock, Check, 
  AlertTriangle, Star, Calendar, 
  MessageSquare, X, Edit3, Trash2, Search,
  PhoneCall, UserPlus, Building2, Sparkles,
  Zap, Target, Award, Volume2, VolumeX,
  LogOut, TrendingUp, DollarSign, Filter,
  BarChart3, PieChart, Activity, FileText,
  Shield, UserCheck, Settings, Database
} from 'lucide-react';
import { Client, Reminder, Property, DailyFeedback, User, Team, TabType } from './types';

// Initialize default admin account
const initializeSystem = () => {
  try {
    const usersData = localStorage.getItem('crm_users');
    let users: User[] = [];
    
    if (usersData) {
      users = JSON.parse(usersData);
    }
    
    // Check if admin account exists
    const adminExists = users.some(u => u.username === 'admin' && u.role === 'admin');
    
    if (!adminExists) {
      const adminUser: User = {
        id: 'admin-001',
        username: 'admin',
        password: 'admin123',
        name: 'المدير العام',
        phone: '',
        role: 'admin',
        team: '',
        isActive: true,
        createdAt: new Date().toISOString(),
        createdBy: 'system',
      };
      
      // Add admin to existing users or create new array
      const updatedUsers = [...users.filter(u => u.username !== 'admin'), adminUser];
      localStorage.setItem('crm_users', JSON.stringify(updatedUsers));
      console.log('✅ تم إنشاء حساب المدير الافتراضي');
      console.log('📝 اسم المستخدم: admin');
      console.log('🔑 كلمة المرور: admin123');
    } else {
      console.log('✅ حساب المدير موجود بالفعل');
    }
  } catch (error) {
    console.error('❌ خطأ في تهيئة النظام:', error);
    // If there's an error, reset and create admin
    const adminUser: User = {
      id: 'admin-001',
      username: 'admin',
      password: 'admin123',
      name: 'المدير العام',
      phone: '',
      role: 'admin',
      team: '',
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: 'system',
    };
    localStorage.setItem('crm_users', JSON.stringify([adminUser]));
  }
};

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginType, setLoginType] = useState<'admin' | 'sales' | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  
  // Data states
  const [clients, setClients] = useState<Client[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [dailyFeedbacks, setDailyFeedbacks] = useState<DailyFeedback[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  
  // Modal states
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showAddFeedback, setShowAddFeedback] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  
  // Selection states
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  
  // Search states
  const [searchTerm, setSearchTerm] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  
  // Notification states
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [inAppNotification, setInAppNotification] = useState<{title: string, body: string} | null>(null);

  // Initialize system on first load
  useEffect(() => {
    initializeSystem();
    const user = localStorage.getItem('current_user');
    if (user) {
      setCurrentUser(JSON.parse(user));
    }
  }, []);

  // Load data when user logs in
  useEffect(() => {
    if (!currentUser) return;
    loadData();
  }, [currentUser]);

  const loadData = () => {
    if (!currentUser) return;
    
    const allClients = JSON.parse(localStorage.getItem('crm_clients') || '[]');
    const allReminders = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
    const allProperties = JSON.parse(localStorage.getItem('crm_properties') || '[]');
    const allFeedbacks = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]');
    const allUsers = JSON.parse(localStorage.getItem('crm_users') || '[]');
    const allTeams = JSON.parse(localStorage.getItem('crm_teams') || '[]');
    
    setUsers(allUsers);
    setTeams(allTeams);
    
    if (currentUser.role === 'admin') {
      // Admin sees all data
      setClients(allClients);
      setReminders(allReminders);
      setProperties(allProperties);
      setDailyFeedbacks(allFeedbacks);
    } else {
      // Sales/Supervisor sees only their data
      setClients(allClients.filter((c: Client) => c.userId === currentUser.id || c.assignedTo === currentUser.id));
      setReminders(allReminders.filter((r: Reminder) => r.userId === currentUser.id));
      setProperties(allProperties.filter((p: Property) => p.userId === currentUser.id));
      setDailyFeedbacks(allFeedbacks.filter((f: DailyFeedback) => f.userId === currentUser.id));
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('current_user');
    setCurrentUser(null);
    setLoginType(null);
  };

  // If not logged in, show login screen
  if (!currentUser) {
    return <LoginScreen onLogin={(user) => {
      setCurrentUser(user);
      localStorage.setItem('current_user', JSON.stringify(user));
    }} />;
  }

  return (
    <div className="min-h-screen bg-[#030014] text-white relative overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }}></div>
      </div>

      {/* Header */}
      <header className="relative z-10 glass-card border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 gradient-primary rounded-xl flex items-center justify-center shadow-lg glow-primary">
              <Building2 className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold gradient-text">Muhammed CRM</h1>
              <p className="text-xs text-gray-400">
                مرحباً {currentUser.name} • 
                <span className={
                  currentUser.role === 'admin' ? 'text-red-400' : 
                  currentUser.role === 'supervisor' ? 'text-amber-400' : 'text-blue-400'
                }>
                  {currentUser.role === 'admin' ? ' مدير' : 
                   currentUser.role === 'supervisor' ? ' مشرف' : ' بائع'}
                </span>
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${
                soundEnabled ? 'bg-purple-500/20 text-purple-400' : 'bg-white/5 text-gray-500'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-lg hover:bg-red-500/30 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              خروج
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="relative z-10 glass-card border-b border-purple-500/10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {getNavigationTabs(currentUser.role).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                  activeTab === tab.id 
                    ? 'border-purple-400 text-purple-300' 
                    : 'border-transparent text-gray-400 hover:text-purple-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'dashboard' && <DashboardView clients={clients} reminders={reminders} properties={properties} />}
        {activeTab === 'clients' && <ClientsView clients={clients} onAdd={() => setShowAddClient(true)} onSelect={setSelectedClient} />}
        {activeTab === 'properties' && <PropertiesView properties={properties} onAdd={() => setShowAddProperty(true)} onSelect={setSelectedProperty} />}
        {activeTab === 'reminders' && <RemindersView reminders={reminders} onAdd={() => setShowAddReminder(true)} />}
        {activeTab === 'daily-feedback' && <DailyFeedbackView feedbacks={dailyFeedbacks} clients={clients} onAdd={() => setShowAddFeedback(true)} />}
        {activeTab === 'admin-users' && currentUser.role !== 'sales' && <AdminUsersView users={users} currentUser={currentUser} onAdd={() => setShowAddUser(true)} onSelect={setSelectedUser} />}
        {activeTab === 'admin-teams' && currentUser.role !== 'sales' && <AdminTeamsView teams={teams} users={users} currentUser={currentUser} onAdd={() => setShowAddTeam(true)} onSelect={setSelectedTeam} />}
        {activeTab === 'admin-settings' && currentUser.role === 'admin' && <AdminSettingsView currentUser={currentUser} users={users} />}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showAddClient && <AddClientModal currentUser={currentUser} onClose={() => setShowAddClient(false)} onSuccess={loadData} />}
        {showAddReminder && <AddReminderModal clients={clients} currentUser={currentUser} onClose={() => setShowAddReminder(false)} onSuccess={loadData} />}
        {showAddProperty && <AddPropertyModal clients={clients} currentUser={currentUser} onClose={() => setShowAddProperty(false)} onSuccess={loadData} />}
        {showAddFeedback && <AddFeedbackModal clients={clients} currentUser={currentUser} onClose={() => setShowAddFeedback(false)} onSuccess={loadData} />}
        {showAddUser && <AddUserModal currentUser={currentUser} onClose={() => setShowAddUser(false)} onSuccess={loadData} />}
        {showAddTeam && <AddTeamModal users={users} currentUser={currentUser} onClose={() => setShowAddTeam(false)} onSuccess={loadData} />}
        {selectedClient && <ClientDetailModal client={selectedClient} onClose={() => setSelectedClient(null)} onSuccess={loadData} />}
        {selectedProperty && <PropertyDetailModal property={selectedProperty} onClose={() => setSelectedProperty(null)} onSuccess={loadData} />}
        {selectedUser && <UserDetailModal user={selectedUser} currentUser={currentUser} onClose={() => setSelectedUser(null)} onSuccess={loadData} />}
        {selectedTeam && <TeamDetailModal team={selectedTeam} users={users} currentUser={currentUser} onClose={() => setSelectedTeam(null)} onSuccess={loadData} />}
      </AnimatePresence>
    </div>
  );
}

// Login Screen with separate admin/sales login
function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [loginType, setLoginType] = useState<'admin' | 'sales' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Initialize system when login screen loads
  useEffect(() => {
    initializeSystem();
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    console.log('🔍 محاولة تسجيل الدخول...');
    console.log('📝 اسم المستخدم:', username);
    console.log('🔑 كلمة المرور:', password);
    console.log('🎯 نوع الدخول:', loginType);
    
    try {
      const usersData = localStorage.getItem('crm_users');
      console.log('📦 البيانات المخزنة:', usersData);
      
      if (!usersData) {
        setError('لا توجد حسابات في النظام. يرجى إعادة تحميل الصفحة.');
        return;
      }
      
      const users: User[] = JSON.parse(usersData);
      console.log('👥 عدد المستخدمين:', users.length);
      console.log('📋 المستخدمين:', users.map(u => ({ username: u.username, role: u.role, isActive: u.isActive })));
      
      const user = users.find(u => 
        u.username === username && 
        u.password === password && 
        u.isActive === true &&
        (loginType === 'admin' ? (u.role === 'admin' || u.role === 'supervisor') : u.role === 'sales')
      );
      
      if (!user) {
        // Provide more specific error message
        const userExists = users.find(u => u.username === username);
        if (!userExists) {
          setError('اسم المستخدم غير موجود');
        } else if (!userExists.isActive) {
          setError('هذا الحساب معطل. يرجى التواصل مع المدير.');
        } else if (userExists.password !== password) {
          setError('كلمة المرور غير صحيحة');
        } else if (loginType === 'admin' && userExists.role === 'sales') {
          setError('هذا حساب بائع. يرجى استخدام "دخول البائعين"');
        } else if (loginType === 'sales' && (userExists.role === 'admin' || userExists.role === 'supervisor')) {
          setError('هذا حساب إداري. يرجى استخدام "دخول الإدارة"');
        } else {
          setError('اسم المستخدم أو كلمة المرور غير صحيحة');
        }
        return;
      }
      
      console.log('✅ تم تسجيل الدخول بنجاح:', user);
      onLogin(user);
    } catch (error) {
      console.error('❌ خطأ في تسجيل الدخول:', error);
      setError('حدث خطأ في النظام. يرجى إعادة تحميل الصفحة.');
    }
  };

  if (!loginType) {
    return (
      <div className="min-h-screen bg-[#030014] flex items-center justify-center p-4">
        <div className="glass-card rounded-3xl p-8 w-full max-w-md glow-primary">
          <div className="text-center mb-8">
            <div className="w-20 h-20 gradient-primary rounded-full flex items-center justify-center mx-auto mb-4 glow-primary">
              <Building2 className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold gradient-text mb-2">Muhammed CRM</h1>
            <p className="text-gray-400">نظام CRM الخاص بمحمد</p>
          </div>
          
          <div className="space-y-4">
            <button
              onClick={() => setLoginType('admin')}
              className="w-full gradient-primary text-white py-4 rounded-xl font-bold text-lg shadow-lg glow-primary btn-hover flex items-center justify-center gap-3"
            >
              <Shield className="w-6 h-6" />
              دخول الإدارة
            </button>
            
            <button
              onClick={() => setLoginType('sales')}
              className="w-full bg-white/10 text-white py-4 rounded-xl font-bold text-lg hover:bg-white/20 transition-colors border border-white/10 flex items-center justify-center gap-3"
            >
              <UserCheck className="w-6 h-6" />
              دخول البائعين
            </button>
          </div>
          
          <div className="mt-6 p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
            <p className="text-sm text-gray-300 text-center">
              <strong className="text-purple-400">حساب المدير الافتراضي:</strong><br />
              المستخدم: admin<br />
              كلمة المرور: admin123
            </p>
          </div>
          
          <button
            onClick={() => {
              if (confirm('هل أنت متأكد من إعادة تعيين النظام؟ سيتم حذف جميع البيانات وإنشاء حساب المدير الافتراضي.')) {
                localStorage.clear();
                initializeSystem();
                window.location.reload();
              }
            }}
            className="w-full mt-4 bg-red-500/10 text-red-400 py-2 rounded-xl text-sm hover:bg-red-500/20 transition-colors border border-red-500/20"
          >
            🔄 إعادة تعيين النظام (مسح جميع البيانات)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#030014] flex items-center justify-center p-4">
      <div className="glass-card rounded-3xl p-8 w-full max-w-md glow-primary">
        <div className="text-center mb-8">
          <div className="w-20 h-20 gradient-primary rounded-full flex items-center justify-center mx-auto mb-4 glow-primary">
            {loginType === 'admin' ? <Shield className="w-10 h-10 text-white" /> : <UserCheck className="w-10 h-10 text-white" />}
          </div>
          <h1 className="text-2xl font-bold gradient-text mb-2">
            {loginType === 'admin' ? 'دخول الإدارة' : 'دخول البائعين'}
          </h1>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">اسم المستخدم</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="اسم المستخدم"
              dir="ltr"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm text-gray-300 mb-1">كلمة المرور</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50 transition-all"
              placeholder="كلمة المرور"
              dir="ltr"
              required
            />
          </div>
          
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
              <p className="text-red-400 text-sm text-center">{error}</p>
            </div>
          )}
          
          <button
            type="submit"
            className="w-full gradient-primary text-white py-3 rounded-xl font-bold text-lg shadow-lg glow-primary btn-hover"
          >
            تسجيل الدخول
          </button>
          
          <button
            type="button"
            onClick={() => setLoginType(null)}
            className="w-full bg-white/10 text-white py-3 rounded-xl font-bold hover:bg-white/20 transition-colors"
          >
            رجوع
          </button>
          
          <button
            type="button"
            onClick={() => {
              if (confirm('هل أنت متأكد من إعادة تعيين النظام؟ سيتم حذف جميع البيانات وإنشاء حساب المدير الافتراضي.')) {
                localStorage.clear();
                initializeSystem();
                window.location.reload();
              }
            }}
            className="w-full bg-red-500/10 text-red-400 py-2 rounded-xl text-sm hover:bg-red-500/20 transition-colors border border-red-500/20"
          >
            🔄 إعادة تعيين النظام
          </button>
        </form>
      </div>
    </div>
  );
}

// Navigation tabs based on role
function getNavigationTabs(role: string) {
  const commonTabs = [
    { id: 'dashboard' as TabType, icon: Home, label: 'الرئيسية' },
    { id: 'clients' as TabType, icon: Users, label: 'العملاء' },
    { id: 'properties' as TabType, icon: Building2, label: 'العقارات' },
    { id: 'reminders' as TabType, icon: Bell, label: 'التذكيرات' },
    { id: 'daily-feedback' as TabType, icon: MessageSquare, label: 'الفيدباك' },
  ];
  
  const adminTabs = [
    { id: 'admin-users' as TabType, icon: UserCheck, label: 'المستخدمين' },
    { id: 'admin-teams' as TabType, icon: Users, label: 'الفرق' },
    { id: 'admin-settings' as TabType, icon: Settings, label: 'الإعدادات' },
  ];
  
  return role === 'sales' ? commonTabs : [...commonTabs, ...adminTabs];
}

// Dashboard View
function DashboardView({ clients, reminders, properties }: { clients: Client[]; reminders: Reminder[]; properties: Property[] }) {
  const stats = {
    totalClients: clients.length,
    totalProperties: properties.length,
    activeReminders: reminders.filter(r => !r.isCompleted).length,
    closedDeals: clients.filter(c => c.stage === 'closed').length,
  };
  
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold gradient-text">لوحة التحكم</h2>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="إجمالي العملاء" value={stats.totalClients} icon={Users} gradient="from-purple-500 to-violet-600" />
        <StatCard label="العقارات" value={stats.totalProperties} icon={Building2} gradient="from-cyan-500 to-purple-500" />
        <StatCard label="التذكيرات النشطة" value={stats.activeReminders} icon={Bell} gradient="from-amber-500 to-purple-500" />
        <StatCard label="صفقات مكتملة" value={stats.closedDeals} icon={Award} gradient="from-emerald-500 to-purple-500" />
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, gradient }: any) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-3`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      <p className="text-sm text-gray-400">{label}</p>
    </div>
  );
}

// Clients View
function ClientsView({ clients, onAdd, onSelect }: any) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold gradient-text">العملاء</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2">
          <Plus className="w-4 h-4" /> إضافة عميل
        </button>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2">
        {clients.map((client: Client) => (
          <div key={client.id} onClick={() => onSelect(client)} className="glass-card rounded-xl p-4 cursor-pointer hover:border-purple-500/50 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                <span className="text-white font-bold">{client.name[0]}</span>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-white">{client.name}</h4>
                <p className="text-sm text-gray-400" dir="ltr">{client.phone}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-purple-500/20 text-purple-400">
                {client.stage === 'new' ? 'جديد' : client.stage === 'contacted' ? 'تم التواصل' : client.stage}
              </span>
            </div>
          </div>
        ))}
      </div>
      
      {clients.length === 0 && (
        <div className="text-center py-16">
          <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">لا يوجد عملاء</p>
        </div>
      )}
    </div>
  );
}

// Properties View
function PropertiesView({ properties, onAdd, onSelect }: any) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold gradient-text">العقارات</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2">
          <Plus className="w-4 h-4" /> إضافة عقار
        </button>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {properties.map((property: Property) => (
          <div key={property.id} onClick={() => onSelect(property)} className="glass-card rounded-xl p-4 cursor-pointer hover:border-purple-500/50 transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                <Building2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h4 className="font-bold text-white">{property.name}</h4>
                <p className="text-sm text-gray-400">{property.type}</p>
              </div>
            </div>
            <p className="text-sm text-purple-400">{property.price}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Reminders View
function RemindersView({ reminders, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold gradient-text">التذكيرات</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2">
          <Plus className="w-4 h-4" /> تذكير جديد
        </button>
      </div>
      
      <div className="space-y-3">
        {reminders.map((reminder: Reminder) => (
          <div key={reminder.id} className="glass-card rounded-xl p-4">
            <h4 className="font-bold text-white">{reminder.clientName}</h4>
            <p className="text-sm text-gray-400" dir="ltr">{reminder.clientPhone}</p>
            <p className="text-xs text-gray-500 mt-1">{reminder.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Daily Feedback View
function DailyFeedbackView({ feedbacks, clients, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold gradient-text">الفيدباك اليومي</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2">
          <Plus className="w-4 h-4" /> إضافة فيدباك
        </button>
      </div>
      
      <div className="space-y-3">
        {feedbacks.map((feedback: DailyFeedback) => (
          <div key={feedback.id} className="glass-card rounded-xl p-4">
            <h4 className="font-bold text-white">{feedback.clientName}</h4>
            <p className="text-sm text-gray-400" dir="ltr">{feedback.clientPhone}</p>
            <p className="text-xs text-gray-500 mt-1">{feedback.feedback}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Admin Users View
function AdminUsersView({ users, currentUser, onAdd, onSelect }: any) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold gradient-text">إدارة المستخدمين</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2">
          <Plus className="w-4 h-4" /> إضافة مستخدم
        </button>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {users.map((user: User) => (
          <div key={user.id} onClick={() => onSelect(user)} className="glass-card rounded-xl p-4 cursor-pointer hover:border-purple-500/50 transition-all">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                <span className="text-white font-bold">{user.name[0]}</span>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-white">{user.name}</h4>
                <p className="text-sm text-gray-400">@{user.username}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                user.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                user.role === 'supervisor' ? 'bg-amber-500/20 text-amber-400' :
                'bg-blue-500/20 text-blue-400'
              }`}>
                {user.role === 'admin' ? 'مدير' : user.role === 'supervisor' ? 'مشرف' : 'بائع'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Admin Teams View
function AdminTeamsView({ teams, users, currentUser, onAdd, onSelect }: any) {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold gradient-text">الفرق</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2">
          <Plus className="w-4 h-4" /> إضافة فريق
        </button>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((team: Team) => (
          <div key={team.id} onClick={() => onSelect(team)} className="glass-card rounded-xl p-4 cursor-pointer hover:border-purple-500/50 transition-all">
            <h4 className="font-bold text-white">{team.name}</h4>
            <p className="text-sm text-gray-400">المشرف: {team.supervisorName}</p>
            <p className="text-sm text-gray-400">عدد الأعضاء: {team.memberIds.length}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Admin Settings View
function AdminSettingsView({ currentUser, users }: any) {
  const handleExportData = () => {
    const data = {
      clients: JSON.parse(localStorage.getItem('crm_clients') || '[]'),
      reminders: JSON.parse(localStorage.getItem('crm_reminders') || '[]'),
      properties: JSON.parse(localStorage.getItem('crm_properties') || '[]'),
      feedbacks: JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]'),
      users: JSON.parse(localStorage.getItem('crm_users') || '[]'),
      teams: JSON.parse(localStorage.getItem('crm_teams') || '[]'),
      exportDate: new Date().toISOString(),
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };
  
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold gradient-text">الإعدادات</h2>
      
      <div className="grid gap-4 md:grid-cols-2">
        <div className="glass-card rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">النسخ الاحتياطي</h3>
          <button onClick={handleExportData} className="w-full gradient-primary text-white py-3 rounded-xl font-bold">
            تصدير البيانات
          </button>
        </div>
        
        <div className="glass-card rounded-xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">معلومات النظام</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">المستخدم:</span>
              <span className="text-white">{currentUser.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">الدور:</span>
              <span className="text-white">{currentUser.role}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">عدد المستخدمين:</span>
              <span className="text-white">{users.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal Components (simplified for brevity)
function AddClientModal({ currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ name: '', phone: '', property: '', budget: '', stage: 'new' });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clients = JSON.parse(localStorage.getItem('crm_clients') || '[]');
    const newClient = { ...form, id: crypto.randomUUID(), userId: currentUser.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    localStorage.setItem('crm_clients', JSON.stringify([newClient, ...clients]));
    onSuccess();
    onClose();
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">إضافة عميل جديد</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="الاسم" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required />
          <input type="tel" placeholder="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <input type="text" placeholder="العقار" value={form.property} onChange={(e) => setForm({ ...form, property: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <input type="text" placeholder="الميزانية" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <button type="submit" className="w-full gradient-primary text-white py-3 rounded-xl font-bold">إضافة</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Other modal components would follow similar pattern...
// For brevity, I'll add placeholder modals
function AddReminderModal({ onClose }: any) { return <div />; }
function AddPropertyModal({ onClose }: any) { return <div />; }
function AddFeedbackModal({ onClose }: any) { return <div />; }
function AddUserModal({ currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ username: '', password: '', name: '', phone: '', role: 'sales' as User['role'] });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const users = JSON.parse(localStorage.getItem('crm_users') || '[]');
    const newUser = { ...form, id: crypto.randomUUID(), isActive: true, createdAt: new Date().toISOString(), createdBy: currentUser.id };
    localStorage.setItem('crm_users', JSON.stringify([...users, newUser]));
    onSuccess();
    onClose();
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">إضافة مستخدم جديد</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="الاسم الكامل" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required />
          <input type="text" placeholder="اسم المستخدم" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <input type="password" placeholder="كلمة المرور" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <input type="tel" placeholder="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white">
            <option value="sales" className="bg-gray-900">بائع</option>
            <option value="supervisor" className="bg-gray-900">مشرف</option>
          </select>
          <button type="submit" className="w-full gradient-primary text-white py-3 rounded-xl font-bold">إضافة</button>
        </form>
      </motion.div>
    </motion.div>
  );
}
function AddTeamModal({ onClose }: any) { return <div />; }
function ClientDetailModal({ onClose }: any) { return <div />; }
function PropertyDetailModal({ onClose }: any) { return <div />; }
function UserDetailModal({ onClose }: any) { return <div />; }
function TeamDetailModal({ onClose }: any) { return <div />; }

export default App;
