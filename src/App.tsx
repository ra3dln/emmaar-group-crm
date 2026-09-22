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
  Shield, UserCheck, Settings
} from 'lucide-react';
import { Client, Reminder, Property, DailyFeedback, User, Team, AssignedLead, TabType } from './types';

// Initialize default admin account
const initializeSystem = () => {
  try {
    const usersData = localStorage.getItem('crm_users');
    let users: User[] = [];
    
    if (usersData) {
      users = JSON.parse(usersData);
    }
    
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
      
      const updatedUsers = [...users.filter(u => u.username !== 'admin'), adminUser];
      localStorage.setItem('crm_users', JSON.stringify(updatedUsers));
    }
  } catch (error) {
    console.error('Error initializing system:', error);
  }
};

// Utility functions
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
    'مليون': 1000000,
    'مليونين': 2000000,
    'الف': 1000,
    'ألف': 1000,
    'الفين': 2000,
    'ألفين': 2000,
    'مليار': 1000000000,
    'نص مليون': 500000,
    'نصف مليون': 500000,
  };
  
  const lowerPrice = price.toLowerCase().trim();
  
  for (const [word, value] of Object.entries(arabicNumbers)) {
    if (lowerPrice.includes(word)) {
      const match = lowerPrice.match(/(\d+\.?\d*)\s*[\*×x]?\s*[\u0600-\u06FF]+/);
      if (match) {
        return parseFloat(match[1]) * value;
      }
      return value;
    }
  }
  
  const cleanPrice = price.replace(/[,\s$€£ج.م]/g, '');
  const num = parseFloat(cleanPrice);
  return isNaN(num) ? 0 : num;
};

const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isReminderDue = (reminder: Reminder): boolean => {
  if (reminder.isCompleted) return false;
  return new Date(reminder.dateTime) <= new Date();
};

const getTimeUntil = (reminder: Reminder): string => {
  const now = new Date();
  const reminderTime = new Date(reminder.dateTime);
  const diff = reminderTime.getTime() - now.getTime();
  
  if (diff <= 0) return 'الآن!';
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} يوم`;
  if (hours > 0) return `${hours} ساعة`;
  return `${minutes} دقيقة`;
};

const playNotificationSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const playTone = (frequency: number, startTime: number, duration: number) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
      
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    };

    const now = audioContext.currentTime;
    playTone(523.25, now, 0.2);
    playTone(659.25, now + 0.15, 0.2);
    playTone(783.99, now + 0.3, 0.2);
    playTone(1046.50, now + 0.45, 0.4);
  } catch (e) {
    console.log('Audio not supported');
  }
};

const vibrateDevice = () => {
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200, 100, 200]);
  }
};

const sendNotification = (title: string, body: string) => {
  if (Notification.permission === 'granted') {
    const notification = new Notification(title, {
      body,
      tag: 'crm-reminder',
      requireInteraction: true,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
};

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  
  const [clients, setClients] = useState<Client[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [dailyFeedbacks, setDailyFeedbacks] = useState<DailyFeedback[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assignedLeads, setAssignedLeads] = useState<AssignedLead[]>([]);
  const [selectedUserFeedback, setSelectedUserFeedback] = useState<User | null>(null);
  
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddReminder, setShowAddReminder] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showAddFeedback, setShowAddFeedback] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showAddAssignedLead, setShowAddAssignedLead] = useState(false);
  
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState(false);
  const [inAppNotification, setInAppNotification] = useState<{title: string, body: string} | null>(null);

  useEffect(() => {
    initializeSystem();
    const user = localStorage.getItem('current_user');
    if (user) {
      setCurrentUser(JSON.parse(user));
    }
    
    if ('Notification' in window && Notification.permission === 'granted') {
      setNotificationPermission(true);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadData();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    
    const checkReminders = () => {
      const allReminders = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
      const currentReminders = currentUser.role === 'admin' 
        ? allReminders 
        : allReminders.filter((r: Reminder) => r.userId === currentUser.id);
      
      const notifiedIds = JSON.parse(localStorage.getItem('crm_notified') || '[]');
      
      currentReminders.forEach((reminder: Reminder) => {
        if (isReminderDue(reminder) && !reminder.isCompleted && !notifiedIds.includes(reminder.id)) {
          notifiedIds.push(reminder.id);
          localStorage.setItem('crm_notified', JSON.stringify(notifiedIds));
          
          if (soundEnabled) playNotificationSound();
          vibrateDevice();
          sendNotification(
            '⏰ تذكير بالاتصال',
            `حان وقت الاتصال بـ ${reminder.clientName}\n${reminder.clientPhone}`
          );
          
          setInAppNotification({
            title: `⏰ حان وقت الاتصال بـ ${reminder.clientName}`,
            body: `${reminder.clientPhone} - ${reminder.note || ''}`
          });
          
          setTimeout(() => setInAppNotification(null), 10000);
        }
      });
    };
    
    checkReminders();
    const interval = setInterval(checkReminders, 5000);
    return () => clearInterval(interval);
  }, [currentUser, soundEnabled]);

  const loadData = () => {
    if (!currentUser) return;
    
    const allClients = JSON.parse(localStorage.getItem('crm_clients') || '[]');
    const allReminders = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
    const allProperties = JSON.parse(localStorage.getItem('crm_properties') || '[]');
    const allFeedbacks = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]');
    const allUsers = JSON.parse(localStorage.getItem('crm_users') || '[]');
    const allTeams = JSON.parse(localStorage.getItem('crm_teams') || '[]');
    const allAssignedLeads = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
    
    setUsers(allUsers);
    setTeams(allTeams);
    setAssignedLeads(allAssignedLeads);
    
    if (currentUser.role === 'admin') {
      setClients(allClients);
      setReminders(allReminders);
      setProperties(allProperties);
      setDailyFeedbacks(allFeedbacks);
    } else {
      setClients(allClients.filter((c: Client) => c.userId === currentUser.id || c.assignedTo === currentUser.id));
      setReminders(allReminders.filter((r: Reminder) => r.userId === currentUser.id));
      setProperties(allProperties.filter((p: Property) => p.userId === currentUser.id));
      setDailyFeedbacks(allFeedbacks.filter((f: DailyFeedback) => f.userId === currentUser.id));
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('current_user');
    setCurrentUser(null);
  };

  const handlePermissionRequest = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission === 'granted');
    }
  };

  if (!currentUser) {
    return <LoginScreen onLogin={(user) => {
      setCurrentUser(user);
      localStorage.setItem('current_user', JSON.stringify(user));
    }} />;
  }

  const filteredClients = clients.filter(c => 
    c.name.includes(searchTerm) || 
    c.phone.includes(searchTerm) || 
    c.property.includes(searchTerm)
  );

  const filteredProperties = properties.filter(p => {
    const searchLower = propertySearch.toLowerCase();
    const searchNumeric = parsePrice(propertySearch);
    
    // Text matching
    const textMatch = p.name.toLowerCase().includes(searchLower) ||
                     p.type.toLowerCase().includes(searchLower) ||
                     p.location.toLowerCase().includes(searchLower);
    
    // Price matching - support both numbers and Arabic words
    const priceMatch = p.price.toLowerCase().includes(searchLower) ||
                      p.priceNumeric === searchNumeric ||
                      (searchNumeric > 0 && Math.abs(p.priceNumeric - searchNumeric) < 1000);
    
    // Check if search contains Arabic number words
    const arabicNumberWords = ['مليون', 'مليونين', 'الف', 'ألف', 'الفين', 'ألفين', 'مليار', 'نص مليون', 'نصف مليون'];
    const containsArabicWord = arabicNumberWords.some(word => searchLower.includes(word));
    
    // If search contains Arabic word, match properties with that word in price
    const arabicWordMatch = containsArabicWord && arabicNumberWords.some(word => 
      p.price.toLowerCase().includes(word)
    );
    
    return textMatch || priceMatch || arabicWordMatch;
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

  return (
    <div className="min-h-screen bg-[#030014] text-white relative overflow-hidden">
      <div className="bg-orb bg-orb-1"></div>
      <div className="bg-orb bg-orb-2"></div>
      <div className="bg-orb bg-orb-3"></div>

      <AnimatePresence>
        {inAppNotification && (
          <motion.div
            initial={{ opacity: 0, y: -100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -100 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4"
          >
            <div className="glass-card rounded-2xl p-4 border-purple-400/50 glow-primary">
              <div className="flex items-start gap-3">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                  className="w-10 h-10 gradient-primary rounded-full flex items-center justify-center"
                >
                  <Bell className="w-5 h-5 text-white" />
                </motion.div>
                <div className="flex-1">
                  <p className="font-bold text-white text-sm">{inAppNotification.title}</p>
                  <p className="text-gray-300 text-xs mt-1">{inAppNotification.body}</p>
                </div>
                <button onClick={() => setInAppNotification(null)} className="p-1 hover:bg-white/10 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="relative z-10 glass-card border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
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
                نظام CRM الخاص بمحمد • {currentUser.name}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg ${soundEnabled ? 'bg-purple-500/20 text-purple-400' : 'bg-white/5 text-gray-500'}`}
            >
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </motion.button>

            {!notificationPermission && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                onClick={handlePermissionRequest}
                className="flex items-center gap-2 bg-purple-500/20 text-purple-300 px-3 py-2 rounded-lg text-sm border border-purple-500/30"
              >
                <Bell className="w-4 h-4" />
                <span className="hidden sm:inline">تفعيل الإشعارات</span>
              </motion.button>
            )}
            
            <motion.button
              whileHover={{ scale: 1.1 }}
              onClick={() => setActiveTab('reminders')}
              className="relative p-2 bg-purple-500/20 rounded-lg"
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
              onClick={() => setShowAddClient(true)}
              className="gradient-primary text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 shadow-lg glow-primary btn-hover"
            >
              <Plus className="w-4 h-4" />
              عميل جديد
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              onClick={handleLogout}
              className="p-2 bg-red-500/20 text-red-400 rounded-lg"
            >
              <LogOut className="w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </header>

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

      <main className="relative z-10 max-w-7xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && currentUser.role === 'sales' && <DashboardView stats={stats} clients={clients} reminders={reminders} properties={properties} />}
          {activeTab === 'clients' && currentUser.role === 'sales' && <ClientsView clients={filteredClients} searchTerm={searchTerm} onSearch={setSearchTerm} onSelect={setSelectedClient} onAdd={() => setShowAddClient(true)} />}
          {activeTab === 'pipeline' && currentUser.role === 'sales' && <PipelineView clients={clients} onUpdateStage={(id: string, stage: Client['stage']) => {
            const updated = clients.map(c => c.id === id ? { ...c, stage } : c);
            setClients(updated);
            const allClients = JSON.parse(localStorage.getItem('crm_clients') || '[]');
            localStorage.setItem('crm_clients', JSON.stringify(allClients.map((c: Client) => c.id === id ? { ...c, stage } : c)));
          }} />}
          {activeTab === 'properties' && currentUser.role === 'sales' && <PropertiesView properties={filteredProperties} searchTerm={propertySearch} onSearch={setPropertySearch} onSelect={setSelectedProperty} onAdd={() => setShowAddProperty(true)} />}
          {activeTab === 'reminders' && currentUser.role === 'sales' && <RemindersView reminders={reminders} onComplete={(id: string) => {
            const updated = reminders.map(r => r.id === id ? { ...r, isCompleted: true } : r);
            setReminders(updated);
            localStorage.setItem('crm_reminders', JSON.stringify(JSON.parse(localStorage.getItem('crm_reminders') || '[]').map((r: Reminder) => r.id === id ? { ...r, isCompleted: true } : r)));
          }} onDelay={(id: string, minutes: number) => {
            const updated = reminders.map(r => {
              if (r.id === id) {
                const newTime = new Date(new Date(r.dateTime).getTime() + minutes * 60000);
                return { ...r, dateTime: newTime.toISOString(), isDelayed: true, delayCount: r.delayCount + 1 };
              }
              return r;
            });
            setReminders(updated);
            localStorage.setItem('crm_reminders', JSON.stringify(JSON.parse(localStorage.getItem('crm_reminders') || '[]').map((r: Reminder) => {
              if (r.id === id) {
                const newTime = new Date(new Date(r.dateTime).getTime() + minutes * 60000);
                return { ...r, dateTime: newTime.toISOString(), isDelayed: true, delayCount: r.delayCount + 1 };
              }
              return r;
            })));
          }} onDelete={(id: string) => {
            setReminders(reminders.filter(r => r.id !== id));
            localStorage.setItem('crm_reminders', JSON.stringify(JSON.parse(localStorage.getItem('crm_reminders') || '[]').filter((r: Reminder) => r.id !== id)));
          }} onAdd={() => setShowAddReminder(true)} />}
          {activeTab === 'daily-feedback' && currentUser.role === 'sales' && <DailyFeedbackView feedbacks={dailyFeedbacks} clients={clients} onDelete={(id: string) => {
            setDailyFeedbacks(dailyFeedbacks.filter(f => f.id !== id));
            localStorage.setItem('crm_daily_feedback', JSON.stringify(JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]').filter((f: DailyFeedback) => f.id !== id)));
          }} onAdd={() => setShowAddFeedback(true)} />}
          {activeTab === 'new-leads' && currentUser.role === 'sales' && <NewLeadsViewForSales assignedLeads={assignedLeads.filter((l: AssignedLead) => l.salesId === currentUser.id)} onMarkViewed={(id: string) => {
            const updated = assignedLeads.map(l => l.id === id ? { ...l, status: 'viewed' as const, viewedAt: new Date().toISOString() } : l);
            setAssignedLeads(updated);
            localStorage.setItem('crm_assigned_leads', JSON.stringify(updated));
          }} />}
          {activeTab === 'reports' && currentUser.role === 'sales' && <ReportsView stats={stats} clients={clients} properties={properties} feedbacks={dailyFeedbacks} />}
          {activeTab === 'admin-users' && currentUser.role !== 'sales' && <AdminUsersView users={users} currentUser={currentUser} onSelect={setSelectedUserFeedback} onAdd={() => setShowAddUser(true)} />}
          {activeTab === 'admin-feedback' && currentUser.role !== 'sales' && <AdminFeedbackView users={users.filter((u: User) => u.role === 'sales')} dailyFeedbacks={dailyFeedbacks} onSelect={setSelectedUserFeedback} />}
          {activeTab === 'admin-leads' && currentUser.role !== 'sales' && <AdminLeadsView assignedLeads={assignedLeads} users={users} currentUser={currentUser} onAdd={() => setShowAddAssignedLead(true)} onDelete={(id: string) => {
            const updated = assignedLeads.filter(l => l.id !== id);
            setAssignedLeads(updated);
            localStorage.setItem('crm_assigned_leads', JSON.stringify(updated));
          }} />}
          {activeTab === 'admin-create-sales' && currentUser.role !== 'sales' && <AdminCreateSalesView users={users} currentUser={currentUser} onAdd={() => setShowAddUser(true)} onDelete={(id: string) => {
            const updated = users.filter((u: User) => u.id !== id);
            setUsers(updated);
            localStorage.setItem('crm_users', JSON.stringify(updated));
          }} />}
          {activeTab === 'admin-settings' && currentUser.role === 'admin' && <AdminSettingsView currentUser={currentUser} users={users} />}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showAddClient && <AddClientModal currentUser={currentUser} onClose={() => setShowAddClient(false)} onSuccess={loadData} />}
        {showAddReminder && <AddReminderModal clients={clients} currentUser={currentUser} onClose={() => setShowAddReminder(false)} onSuccess={loadData} />}
        {showAddProperty && <AddPropertyModal clients={clients} currentUser={currentUser} onClose={() => setShowAddProperty(false)} onSuccess={loadData} />}
        {showAddFeedback && <AddFeedbackModal clients={clients} currentUser={currentUser} onClose={() => setShowAddFeedback(false)} onSuccess={loadData} />}
        {showAddUser && <AddUserModal currentUser={currentUser} onClose={() => setShowAddUser(false)} onSuccess={loadData} />}
        {showAddTeam && <AddTeamModal users={users} currentUser={currentUser} onClose={() => setShowAddTeam(false)} onSuccess={loadData} />}
        {showAddAssignedLead && <AddAssignedLeadModal users={users} currentUser={currentUser} onClose={() => setShowAddAssignedLead(false)} onSuccess={loadData} />}
        {selectedUserFeedback && <UserFeedbackModal user={selectedUserFeedback} feedbacks={dailyFeedbacks.filter((f: DailyFeedback) => f.userId === selectedUserFeedback.id)} onClose={() => setSelectedUserFeedback(null)} />}
        {selectedClient && <ClientDetailModal client={selectedClient} onClose={() => setSelectedClient(null)} onSuccess={loadData} />}
        {selectedProperty && <PropertyDetailModal property={selectedProperty} onClose={() => setSelectedProperty(null)} onSuccess={loadData} />}
        {selectedUser && <UserDetailModal user={selectedUser} currentUser={currentUser} onClose={() => setSelectedUser(null)} onSuccess={loadData} />}
        {selectedTeam && <TeamDetailModal team={selectedTeam} users={users} currentUser={currentUser} onClose={() => setSelectedTeam(null)} onSuccess={loadData} />}
      </AnimatePresence>
    </div>
  );
}

function getNavigationTabs(role: string) {
  // تبويبات السيلز فقط
  const salesTabs = [
    { id: 'dashboard' as TabType, icon: Home, label: 'الرئيسية' },
    { id: 'clients' as TabType, icon: Users, label: 'العملاء' },
    { id: 'pipeline' as TabType, icon: Target, label: 'المراحل' },
    { id: 'properties' as TabType, icon: Building2, label: 'العقارات' },
    { id: 'reminders' as TabType, icon: Bell, label: 'التذكيرات' },
    { id: 'daily-feedback' as TabType, icon: MessageSquare, label: 'الفيدباك' },
    { id: 'new-leads' as TabType, icon: UserPlus, label: 'أرقام جديدة' },
    { id: 'reports' as TabType, icon: BarChart3, label: 'التقارير' },
  ];
  
  // تبويبات الإدارة فقط
  const adminTabs = [
    { id: 'admin-users' as TabType, icon: UserCheck, label: 'فريق العمل' },
    { id: 'admin-feedback' as TabType, icon: MessageSquare, label: 'الفيدباك اليومي' },
    { id: 'admin-leads' as TabType, icon: UserPlus, label: 'توزيع الأرقام' },
    { id: 'admin-create-sales' as TabType, icon: UserPlus, label: 'إنشاء حسابات سيلز' },
    { id: 'admin-settings' as TabType, icon: Settings, label: 'الإعدادات' },
  ];
  
  return role === 'sales' ? salesTabs : adminTabs;
}

// Login Screen
function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [loginType, setLoginType] = useState<'admin' | 'sales' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    initializeSystem();
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const users: User[] = JSON.parse(localStorage.getItem('crm_users') || '[]');
    const user = users.find(u => 
      u.username === username && 
      u.password === password && 
      u.isActive &&
      (loginType === 'admin' ? (u.role === 'admin' || u.role === 'supervisor') : u.role === 'sales')
    );
    
    if (!user) {
      setError('اسم المستخدم أو كلمة المرور غير صحيحة');
      return;
    }
    
    onLogin(user);
  };

  if (!loginType) {
    return (
      <div className="min-h-screen bg-[#030014] flex items-center justify-center p-4">
        <div className="glass-card rounded-3xl p-8 w-full max-w-md glow-primary">
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
              دخول السيلز
            </button>
          </div>
          
          <div className="mt-6 p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
            <p className="text-sm text-gray-300 text-center">
              <strong className="text-purple-400">حساب المدير:</strong><br />
              المستخدم: admin<br />
              كلمة المرور: admin123
            </p>
          </div>
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
            {loginType === 'admin' ? 'دخول الإدارة' : 'دخول السيلز'}
          </h1>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">اسم المستخدم</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50"
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
              className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white focus:border-purple-500/50"
              placeholder="كلمة المرور"
              dir="ltr"
              required
            />
          </div>
          
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          
          <button
            type="submit"
            className="w-full gradient-primary text-white py-3 rounded-xl font-bold text-lg shadow-lg glow-primary btn-hover"
          >
            تسجيل الدخول
          </button>
          
          <button
            type="button"
            onClick={() => setLoginType(null)}
            className="w-full bg-white/10 text-white py-3 rounded-xl font-bold hover:bg-white/20"
          >
            رجوع
          </button>
        </form>
      </div>
    </div>
  );
}

// Dashboard View
function DashboardView({ stats, clients, reminders, properties }: any) {
  const dueReminders = reminders.filter((r: Reminder) => isReminderDue(r) && !r.isCompleted);
  
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-6 relative overflow-hidden">
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
          { label: 'عملاء كامبين', value: stats.campaignClients, icon: UserPlus, gradient: 'from-violet-500 to-purple-600' },
          { label: 'عملاء فيسبوك', value: stats.facebookClients, icon: Star, gradient: 'from-emerald-500 to-purple-500' },
          { label: 'عملاء خارجي', value: stats.externalClients, icon: Award, gradient: 'from-purple-500 to-pink-500' },
          { label: 'العقارات', value: stats.totalProperties, icon: Building2, gradient: 'from-cyan-500 to-purple-500' },
          { label: 'مستحقة الآن', value: stats.dueNow, icon: Zap, gradient: 'from-amber-500 to-purple-500' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
            whileHover={{ scale: 1.05, y: -5 }} className="glass-card rounded-2xl p-4">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-3`}>
              <stat.icon className="w-6 h-6 text-white" />
            </div>
            <p className="text-3xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {dueReminders.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card rounded-2xl p-6 border-red-500/30">
          <h3 className="text-lg font-bold text-red-400 mb-4">⚠️ تذكيرات مستحقة الآن</h3>
          <div className="space-y-3">
            {dueReminders.map((reminder: Reminder) => (
              <div key={reminder.id} className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                <p className="font-bold text-white">{reminder.clientName}</p>
                <p className="text-sm text-gray-400" dir="ltr">{reminder.clientPhone}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Clients View
function ClientsView({ clients, searchTerm, onSearch, onSelect, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="بحث..." value={searchTerm} onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl pr-11 pl-4 py-3 text-white focus:border-purple-500/50" />
        </div>
        <button onClick={onAdd} className="gradient-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg glow-primary">
          <Plus className="w-5 h-5" /> إضافة عميل
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {clients.map((client: Client) => (
          <motion.div key={client.id} whileHover={{ scale: 1.02 }} onClick={() => onSelect(client)}
            className="glass-card rounded-2xl p-5 cursor-pointer">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                  <span className="text-white font-bold">{client.name[0]}</span>
                </div>
                <div>
                  <h4 className="font-bold text-white">{client.name}</h4>
                  <p className="text-sm text-gray-400" dir="ltr">{client.phone}</p>
                  {client.phones && client.phones.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {client.phones.map((phone, index) => (
                        <span key={index} className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full" dir="ltr">
                          {phone}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <StatusBadge status={client.status} />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// Pipeline View
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
      <h2 className="text-xl font-bold gradient-text">مراحل العملاء</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {stages.map((stage) => {
          const stageClients = clients.filter((c: Client) => c.stage === stage.id);
          return (
            <div key={stage.id} className="glass-card rounded-2xl p-4">
              <div className={`bg-gradient-to-r ${stage.color} rounded-xl p-3 mb-3`}>
                <div className="flex items-center justify-between">
                  <span className="text-2xl">{stage.icon}</span>
                  <span className="bg-white/20 text-white px-2 py-1 rounded-full text-sm font-bold">{stageClients.length}</span>
                </div>
                <h3 className="font-bold text-white mt-2">{stage.label}</h3>
              </div>
              <div className="space-y-2">
                {stageClients.map((client: Client) => (
                  <div key={client.id} className="bg-white/5 rounded-lg p-3">
                    <p className="font-medium text-white text-sm">{client.name}</p>
                    <p className="text-xs text-gray-400" dir="ltr">{client.phone}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Properties View
function PropertiesView({ properties, searchTerm, onSearch, onSelect, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input type="text" placeholder="بحث ذكي: اسم، نوع، موقع، أو سعر..." value={searchTerm} onChange={(e) => onSearch(e.target.value)}
            className="w-full bg-white/5 border border-purple-500/20 rounded-xl pr-11 pl-4 py-3 text-white focus:border-purple-500/50" />
        </div>
        <button onClick={onAdd} className="gradient-primary text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg glow-primary">
          <Plus className="w-5 h-5" /> إضافة عقار
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {properties.map((property: Property) => (
          <motion.div key={property.id} whileHover={{ scale: 1.02 }} onClick={() => onSelect(property)}
            className="glass-card rounded-2xl p-5 cursor-pointer">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                <Building2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h4 className="font-bold text-white">{property.name}</h4>
                <p className="text-sm text-gray-400">{property.type}</p>
              </div>
            </div>
            <p className="text-sm text-purple-400 font-bold">{formatPrice(property.price)}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// Reminders View
function RemindersView({ reminders, onComplete, onDelay, onDelete, onAdd }: any) {
  const pending = reminders.filter((r: Reminder) => !r.isCompleted);
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text">التذكيرات</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary">
          <Plus className="w-4 h-4" /> تذكير جديد
        </button>
      </div>

      <div className="space-y-3">
        {pending.map((reminder: Reminder) => {
          const isDue = isReminderDue(reminder);
          return (
            <div key={reminder.id} className={`glass-card rounded-2xl p-4 ${isDue ? 'border-red-500/50' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-white text-lg">{reminder.clientName}</h4>
                  <p className="text-sm text-purple-400" dir="ltr">{reminder.clientPhone}</p>
                  <p className="text-xs text-gray-400 mt-1">{formatDateTime(reminder.dateTime)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => onComplete(reminder.id)} className="p-2 bg-emerald-500/20 rounded-lg">
                    <Check className="w-4 h-4 text-emerald-400" />
                  </button>
                  <button onClick={() => onDelay(reminder.id, 30)} className="p-2 bg-amber-500/20 rounded-lg">
                    <Clock className="w-4 h-4 text-amber-400" />
                  </button>
                  <button onClick={() => onDelete(reminder.id)} className="p-2 bg-red-500/20 rounded-lg">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Daily Feedback View
function DailyFeedbackView({ feedbacks, clients, onDelete, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text">الفيدباك اليومي</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary">
          <Plus className="w-4 h-4" /> إضافة فيدباك
        </button>
      </div>

      <div className="space-y-3">
        {feedbacks.map((feedback: DailyFeedback) => (
          <div key={feedback.id} className="glass-card rounded-2xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-bold text-white text-lg">{feedback.clientName}</h4>
                <p className="text-sm text-purple-400" dir="ltr">{feedback.clientPhone}</p>
                <p className="text-xs text-gray-400 mt-1">{formatDateTime(feedback.date)}</p>
                {feedback.feedback && <p className="text-sm text-gray-300 mt-2">{feedback.feedback}</p>}
              </div>
              <button onClick={() => onDelete(feedback.id)} className="p-2 bg-red-500/20 rounded-lg">
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Reports View
function ReportsView({ stats, clients, properties, feedbacks }: any) {
  const conversionRate = clients.length > 0 ? ((stats.closedStage / clients.length) * 100).toFixed(1) : 0;
  
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold gradient-text">التقارير والإحصائيات</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{conversionRate}%</p>
              <p className="text-sm text-gray-400">نسبة التحويل</p>
            </div>
          </div>
        </div>
        
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center">
              <PhoneCall className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-3xl font-bold text-white">{feedbacks.filter((f: DailyFeedback) => f.callStatus === 'called').length}</p>
              <p className="text-sm text-gray-400">إجمالي المكالمات</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Admin Feedback View - Show feedback for each sales person
function AdminFeedbackView({ users, dailyFeedbacks, onSelect }: any) {
  const salesUsers = users.filter((u: User) => u.role === 'sales' || u.role === 'supervisor');
  
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold gradient-text flex items-center gap-2">
        <MessageSquare className="w-6 h-6" />
        الفيدباك اليومي لكل سيلز
      </h2>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {salesUsers.map((user: User) => {
          const userFeedbacks = dailyFeedbacks.filter((f: DailyFeedback) => f.userId === user.id);
          const today = new Date().toDateString();
          const todayFeedbacks = userFeedbacks.filter((f: DailyFeedback) => 
            new Date(f.date).toDateString() === today
          );
          const calledToday = todayFeedbacks.filter((f: DailyFeedback) => f.callStatus === 'called').length;
          const totalCalls = userFeedbacks.filter((f: DailyFeedback) => f.callStatus === 'called').length;
          
          return (
            <motion.div
              key={user.id}
              whileHover={{ scale: 1.02, y: -5 }}
              onClick={() => onSelect(user)}
              className="glass-card rounded-2xl p-5 cursor-pointer"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                  <span className="text-white font-bold">{user.name[0]}</span>
                </div>
                <div>
                  <h4 className="font-bold text-white">{user.name}</h4>
                  <p className="text-sm text-gray-400">{user.role === 'sales' ? 'سيلز' : 'مشرف'}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-purple-500/10 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-purple-400">{todayFeedbacks.length}</p>
                  <p className="text-xs text-gray-400">فيدباك اليوم</p>
                </div>
                <div className="bg-emerald-500/10 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-400">{calledToday}</p>
                  <p className="text-xs text-gray-400">مكالمات اليوم</p>
                </div>
                <div className="bg-blue-500/10 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-blue-400">{userFeedbacks.length}</p>
                  <p className="text-xs text-gray-400">إجمالي الفيدباك</p>
                </div>
                <div className="bg-amber-500/10 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-amber-400">{totalCalls}</p>
                  <p className="text-xs text-gray-400">إجمالي المكالمات</p>
                </div>
              </div>
              
              <p className="text-xs text-gray-500 mt-3 text-center">اضغط لعرض التفاصيل</p>
            </motion.div>
          );
        })}
      </div>

      {salesUsers.length === 0 && (
        <div className="text-center py-16">
          <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">لا يوجد سيلز في الفريق</p>
        </div>
      )}
    </div>
  );
}

// Admin Users View - Simplified
function AdminUsersView({ users, currentUser, onSelect, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text">فريق العمل</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary">
          <Plus className="w-4 h-4" /> إضافة سيلز
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {users.map((user: User) => (
          <motion.div key={user.id} whileHover={{ scale: 1.02 }} onClick={() => onSelect(user)}
            className="glass-card rounded-2xl p-5 cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                <span className="text-white font-bold">{user.name[0]}</span>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-white">{user.name}</h4>
                <p className="text-sm text-gray-400">{user.role === 'admin' ? 'مدير' : user.role === 'supervisor' ? 'مشرف' : 'سيلز'}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// New Leads View - For Sales (shows leads assigned to this sales person)
function NewLeadsViewForSales({ assignedLeads, onMarkViewed }: any) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold gradient-text">أرقام جديدة</h2>

      <div className="space-y-3">
        {assignedLeads.map((lead: AssignedLead) => (
          <motion.div key={lead.id} whileHover={{ scale: 1.01 }}
            className="glass-card rounded-2xl p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-bold text-white text-lg">{lead.name}</h4>
                <p className="text-purple-400 text-lg" dir="ltr">{lead.phone}</p>
                {lead.description && <p className="text-sm text-gray-400 mt-2">{lead.description}</p>}
                <p className="text-xs text-gray-500 mt-2">
                  {formatDateTime(lead.createdAt)}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <span className={`text-xs px-3 py-1 rounded-full ${
                  lead.status === 'new' ? 'bg-blue-500/20 text-blue-400' :
                  lead.status === 'viewed' ? 'bg-purple-500/20 text-purple-400' :
                  lead.status === 'contacted' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-emerald-500/20 text-emerald-400'
                }`}>
                  {lead.status === 'new' ? 'رقم جديد' : 
                   lead.status === 'viewed' ? 'تم العرض' :
                   lead.status === 'contacted' ? 'تم التواصل' : 'مغلق'}
                </span>
                {lead.status === 'new' && (
                  <button 
                    onClick={() => onMarkViewed(lead.id)}
                    className="gradient-primary text-white px-4 py-2 rounded-lg font-bold text-sm"
                  >
                    تم العرض
                  </button>
                )}
                <a 
                  href={`tel:${lead.phone}`}
                  className="bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-lg font-bold text-sm text-center hover:bg-emerald-500/30 transition-colors"
                >
                  اتصال
                </a>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {assignedLeads.length === 0 && (
        <div className="text-center py-16">
          <UserPlus className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">لا يوجد أرقام جديدة</p>
        </div>
      )}
    </div>
  );
}

// Admin Leads View - For Admin to assign leads to sales
function AdminLeadsView({ assignedLeads, users, currentUser, onAdd, onDelete }: any) {
  const salesUsers = users.filter((u: User) => u.role === 'sales' || u.role === 'supervisor');
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text">توزيع الأرقام</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary">
          <Plus className="w-4 h-4" /> إضافة رقم
        </button>
      </div>

      <div className="space-y-3">
        {assignedLeads.map((lead: AssignedLead) => (
          <motion.div key={lead.id} whileHover={{ scale: 1.01 }}
            className="glass-card rounded-2xl p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-bold text-white text-lg">{lead.name}</h4>
                <p className="text-purple-400" dir="ltr">{lead.phone}</p>
                {lead.description && <p className="text-sm text-gray-400 mt-2">{lead.description}</p>}
                <p className="text-xs text-gray-500 mt-2">
                  مخصص لـ: <span className="text-purple-400">{users.find((u: User) => u.id === lead.salesId)?.name || 'غير محدد'}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <span className={`text-xs px-2 py-1 rounded-full ${
                  lead.status === 'new' ? 'bg-blue-500/20 text-blue-400' :
                  lead.status === 'viewed' ? 'bg-purple-500/20 text-purple-400' :
                  lead.status === 'contacted' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-emerald-500/20 text-emerald-400'
                }`}>
                  {lead.status === 'new' ? 'بانتظار العرض' : 
                   lead.status === 'viewed' ? 'تم العرض' :
                   lead.status === 'contacted' ? 'تم التواصل' : 'مغلق'}
                </span>
                <button onClick={() => onDelete(lead.id)} className="p-1 bg-red-500/20 rounded-lg">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {assignedLeads.length === 0 && (
        <div className="text-center py-16">
          <UserPlus className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">لا يوجد أرقام موزعة</p>
        </div>
      )}
    </div>
  );
}

// Admin Create Sales View - For Admin to create sales accounts
function AdminCreateSalesView({ users, currentUser, onAdd, onDelete }: any) {
  const salesUsers = users.filter((u: User) => u.role === 'sales');
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text">إنشاء حسابات سيلز</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary">
          <Plus className="w-4 h-4" /> إنشاء حساب سيلز
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {salesUsers.map((user: User) => (
          <motion.div key={user.id} whileHover={{ scale: 1.02 }}
            className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
                <span className="text-white font-bold">{user.name[0]}</span>
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-white">{user.name}</h4>
                <p className="text-sm text-gray-400">@{user.username}</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500" dir="ltr">{user.phone || 'لا يوجد رقم'}</p>
              <button onClick={() => onDelete(user.id)} className="p-2 bg-red-500/20 rounded-lg hover:bg-red-500/30 transition-colors">
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {salesUsers.length === 0 && (
        <div className="text-center py-16">
          <UserPlus className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">لا يوجد حسابات سيلز</p>
          <p className="text-gray-500 text-sm mt-2">اضغط على "إنشاء حساب سيلز" لإضافة حساب جديد</p>
        </div>
      )}
    </div>
  );
}

// Admin Teams View
function AdminTeamsView({ teams, users, currentUser, onSelect, onAdd }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold gradient-text">الفرق</h2>
        <button onClick={onAdd} className="gradient-primary text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg glow-primary">
          <Plus className="w-4 h-4" /> إضافة فريق
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((team: Team) => (
          <motion.div key={team.id} whileHover={{ scale: 1.02 }} onClick={() => onSelect(team)}
            className="glass-card rounded-2xl p-5 cursor-pointer">
            <h4 className="font-bold text-white">{team.name}</h4>
            <p className="text-sm text-gray-400">المشرف: {team.supervisorName}</p>
            <p className="text-sm text-gray-400">عدد الأعضاء: {team.memberIds.length}</p>
          </motion.div>
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
      </div>
    </div>
  );
}

// Status Badge
function StatusBadge({ status }: { status: Client['status'] }) {
  const config = {
    campaign: { label: 'كامبين', className: 'bg-purple-500/20 text-purple-400' },
    facebook: { label: 'فيسبوك', className: 'bg-blue-500/20 text-blue-400' },
    external: { label: 'خارجي', className: 'bg-emerald-500/20 text-emerald-400' },
  };
  
  const { label, className } = config[status];
  return <span className={`text-xs px-2.5 py-1 rounded-full ${className}`}>{label}</span>;
}

// Modal Components (simplified)
function AddClientModal({ currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ name: '', phone: '', phones: [] as string[], property: '', budget: '', monthlyInstallment: '', deliveryPeriod: '', status: 'campaign', stage: 'new', feedback: '', priority: 'medium', source: '' });
  const [newPhone, setNewPhone] = useState('');
  
  const addPhone = () => {
    if (newPhone && !form.phones.includes(newPhone)) {
      setForm({ ...form, phones: [...form.phones, newPhone] });
      setNewPhone('');
    }
  };
  
  const removePhone = (phone: string) => {
    setForm({ ...form, phones: form.phones.filter(p => p !== phone) });
  };
  
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
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">إضافة عميل جديد</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="الاسم *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required />
          <input type="tel" placeholder="رقم الهاتف الرئيسي *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          
          <div>
            <label className="block text-sm text-gray-300 mb-2">أرقام إضافية</label>
            <div className="flex gap-2">
              <input type="tel" placeholder="رقم إضافي" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="flex-1 bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" />
              <button type="button" onClick={addPhone} className="gradient-primary text-white px-4 py-3 rounded-xl font-bold">
                <Plus className="w-5 h-5" />
              </button>
            </div>
            {form.phones.length > 0 && (
              <div className="mt-2 space-y-2">
                {form.phones.map((phone, index) => (
                  <div key={index} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                    <span className="text-white text-sm" dir="ltr">{phone}</span>
                    <button type="button" onClick={() => removePhone(phone)} className="p-1 hover:bg-red-500/20 rounded">
                      <X className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <input type="text" placeholder="العقار" value={form.property} onChange={(e) => setForm({ ...form, property: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <input type="text" placeholder="الميزانية" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <input type="text" placeholder="القسط الشهري" value={form.monthlyInstallment} onChange={(e) => setForm({ ...form, monthlyInstallment: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <input type="text" placeholder="مدة الاستلام" value={form.deliveryPeriod} onChange={(e) => setForm({ ...form, deliveryPeriod: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white">
            <option value="campaign" className="bg-gray-900">كامبين</option>
            <option value="facebook" className="bg-gray-900">فيسبوك</option>
            <option value="external" className="bg-gray-900">خارجي</option>
          </select>
          <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white">
            <option value="new" className="bg-gray-900">جديد</option>
            <option value="contacted" className="bg-gray-900">تم التواصل</option>
            <option value="meeting" className="bg-gray-900">موعد معاينة</option>
            <option value="negotiation" className="bg-gray-900">تفاوض</option>
            <option value="closed" className="bg-gray-900">تم البيع</option>
            <option value="lost" className="bg-gray-900">ضائع</option>
          </select>
          <textarea placeholder="ملاحظات" value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white resize-none h-24" />
          <button type="submit" className="w-full gradient-primary text-white py-3 rounded-xl font-bold">إضافة</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddReminderModal({ clients, currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ clientId: '', clientName: '', clientPhone: '', dateTime: '', note: '' });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const reminders = JSON.parse(localStorage.getItem('crm_reminders') || '[]');
    const newReminder = { ...form, id: crypto.randomUUID(), userId: currentUser.id, isCompleted: false, isDelayed: false, delayCount: 0, createdAt: new Date().toISOString() };
    localStorage.setItem('crm_reminders', JSON.stringify([newReminder, ...reminders]));
    onSuccess();
    onClose();
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">إضافة تذكير</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="اسم العميل *" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required />
          <input type="tel" placeholder="رقم الهاتف *" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <input type="datetime-local" value={form.dateTime} onChange={(e) => setForm({ ...form, dateTime: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <textarea placeholder="ملاحظة" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white resize-none h-20" />
          <button type="submit" className="w-full gradient-primary text-white py-3 rounded-xl font-bold">إضافة</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddPropertyModal({ clients, currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ name: '', type: '', area: '', price: '', priceNumeric: 0, location: '', description: '', image: '', clientPhone: '', clientName: '', project: '', compound: '', floor: '', rooms: '', bathrooms: '', finishing: 'fully-finished', delivery: 'immediate' });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const properties = JSON.parse(localStorage.getItem('crm_properties') || '[]');
    const newProperty = { ...form, priceNumeric: parsePrice(form.price), id: crypto.randomUUID(), userId: currentUser.id, createdAt: new Date().toISOString() };
    localStorage.setItem('crm_properties', JSON.stringify([newProperty, ...properties]));
    onSuccess();
    onClose();
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">إضافة عقار</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="اسم العقار *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required>
            <option value="" className="bg-gray-900">اختر النوع</option>
            <option value="شقة" className="bg-gray-900">شقة</option>
            <option value="فيلا" className="bg-gray-900">فيلا</option>
            <option value="أرض" className="bg-gray-900">أرض</option>
          </select>
          <input type="text" placeholder="المساحة" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <input type="text" placeholder="السعر (رقم أو كلمة)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <input type="text" placeholder="الموقع" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <input type="tel" placeholder="رقم العميل (اختياري)" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" />
          <input type="text" placeholder="اسم العميل" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" />
          <button type="submit" className="w-full gradient-primary text-white py-3 rounded-xl font-bold">إضافة</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddFeedbackModal({ clients, currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ clientPhone: '', clientName: '', date: new Date().toISOString().slice(0, 16), feedback: '', callStatus: 'called', duration: '', nextAction: '' });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const feedbacks = JSON.parse(localStorage.getItem('crm_daily_feedback') || '[]');
    const newFeedback = { ...form, id: crypto.randomUUID(), userId: currentUser.id, createdAt: new Date().toISOString() };
    localStorage.setItem('crm_daily_feedback', JSON.stringify([newFeedback, ...feedbacks]));
    onSuccess();
    onClose();
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">إضافة فيدباك</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="tel" placeholder="رقم العميل *" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <input type="text" placeholder="اسم العميل *" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required />
          <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <select value={form.callStatus} onChange={(e) => setForm({ ...form, callStatus: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white">
            <option value="called" className="bg-gray-900">تم الاتصال</option>
            <option value="no-answer" className="bg-gray-900">لا رد</option>
            <option value="busy" className="bg-gray-900">مشغول</option>
            <option value="not-called" className="bg-gray-900">لم يتصل</option>
          </select>
          <textarea placeholder="الفيدباك" value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white resize-none h-24" />
          <button type="submit" className="w-full gradient-primary text-white py-3 rounded-xl font-bold">إضافة</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddUserModal({ currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ username: '', password: '', name: '', phone: '' });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const users = JSON.parse(localStorage.getItem('crm_users') || '[]');
    
    // Check if username already exists
    if (users.some((u: User) => u.username === form.username)) {
      alert('اسم المستخدم موجود بالفعل');
      return;
    }
    
    const newUser: User = { 
      username: form.username,
      password: form.password,
      name: form.name,
      phone: form.phone,
      role: 'sales',
      isActive: true, 
      id: crypto.randomUUID(), 
      createdAt: new Date().toISOString(), 
      createdBy: currentUser.id 
    };
    localStorage.setItem('crm_users', JSON.stringify([...users, newUser]));
    onSuccess();
    onClose();
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">إنشاء حساب سيلز جديد</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="الاسم الكامل *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required />
          <input type="text" placeholder="اسم المستخدم *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <input type="password" placeholder="كلمة المرور *" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <input type="tel" placeholder="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" />
          <button type="submit" className="w-full gradient-primary text-white py-3 rounded-xl font-bold">إنشاء الحساب</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AddTeamModal({ users, currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ name: '', supervisorId: '', supervisorName: '', memberIds: [] as string[] });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const teams = JSON.parse(localStorage.getItem('crm_teams') || '[]');
    const supervisor = users.find((u: User) => u.id === form.supervisorId);
    const newTeam = { ...form, supervisorName: supervisor?.name || '', id: crypto.randomUUID(), createdAt: new Date().toISOString(), createdBy: currentUser.id };
    localStorage.setItem('crm_teams', JSON.stringify([...teams, newTeam]));
    onSuccess();
    onClose();
  };
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">إضافة فريق</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="اسم الفريق *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required />
          <select value={form.supervisorId} onChange={(e) => setForm({ ...form, supervisorId: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required>
            <option value="" className="bg-gray-900">اختر المشرف</option>
            {users.filter((u: User) => u.role === 'supervisor' || u.role === 'admin').map((u: User) => (
              <option key={u.id} value={u.id} className="bg-gray-900">{u.name}</option>
            ))}
          </select>
          <button type="submit" className="w-full gradient-primary text-white py-3 rounded-xl font-bold">إضافة</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Add Assigned Lead Modal
function AddAssignedLeadModal({ users, currentUser, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ name: '', phone: '', description: '', salesId: '' });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const leads = JSON.parse(localStorage.getItem('crm_assigned_leads') || '[]');
    const newLead: AssignedLead = { 
      ...form, 
      id: crypto.randomUUID(), 
      adminId: currentUser.id, 
      status: 'new',
      createdAt: new Date().toISOString() 
    };
    localStorage.setItem('crm_assigned_leads', JSON.stringify([newLead, ...leads]));
    onSuccess();
    onClose();
  };
  
  const salesUsers = users.filter((u: User) => u.role === 'sales' || u.role === 'supervisor');
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">توزيع رقم جديد</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="اسم العميل *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required />
          <input type="tel" placeholder="رقم الهاتف *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" dir="ltr" required />
          <textarea placeholder="وصف/ملاحظات" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white resize-none h-20" />
          <select value={form.salesId} onChange={(e) => setForm({ ...form, salesId: e.target.value })} className="w-full bg-white/5 border border-purple-500/20 rounded-xl px-4 py-3 text-white" required>
            <option value="" className="bg-gray-900">اختر السيلز</option>
            {salesUsers.map((u: User) => (
              <option key={u.id} value={u.id} className="bg-gray-900">{u.name}</option>
            ))}
          </select>
          <button type="submit" className="w-full gradient-primary text-white py-3 rounded-xl font-bold">توزيع الرقم</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// User Feedback Modal - Show daily feedback for a user
function UserFeedbackModal({ user, feedbacks, onClose }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 gradient-primary rounded-full flex items-center justify-center">
              <span className="text-white font-bold">{user.name[0]}</span>
            </div>
            <div>
              <h2 className="text-xl font-bold gradient-text">{user.name}</h2>
              <p className="text-sm text-gray-400">الفيدباك اليومي</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {feedbacks.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">لا يوجد فيدباك يومي</p>
          </div>
        ) : (
          <div className="space-y-3">
            {feedbacks.map((feedback: DailyFeedback) => (
              <div key={feedback.id} className="bg-white/5 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-bold text-white">{feedback.clientName}</p>
                    <p className="text-sm text-purple-400" dir="ltr">{feedback.clientPhone}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
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
                <p className="text-xs text-gray-400">{formatDateTime(feedback.date)}</p>
                {feedback.feedback && <p className="text-sm text-gray-300 mt-2">{feedback.feedback}</p>}
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function ClientDetailModal({ client, onClose, onSuccess }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">{client.name}</h2>
        <div className="space-y-3">
          <p className="text-gray-300" dir="ltr">{client.phone}</p>
          <p className="text-gray-300">{client.property}</p>
          <p className="text-gray-300">{client.budget}</p>
        </div>
        <button onClick={onClose} className="w-full mt-6 bg-white/10 text-white py-3 rounded-xl font-bold">إغلاق</button>
      </motion.div>
    </motion.div>
  );
}

function PropertyDetailModal({ property, onClose, onSuccess }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">{property.name}</h2>
        <div className="space-y-3">
          <p className="text-gray-300">{property.type}</p>
          <p className="text-gray-300">{property.area}</p>
          <p className="text-purple-400 font-bold">{formatPrice(property.price)}</p>
        </div>
        <button onClick={onClose} className="w-full mt-6 bg-white/10 text-white py-3 rounded-xl font-bold">إغلاق</button>
      </motion.div>
    </motion.div>
  );
}

function UserDetailModal({ user, currentUser, onClose, onSuccess }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">{user.name}</h2>
        <div className="space-y-3">
          <p className="text-gray-300">@{user.username}</p>
          <p className="text-gray-300">{user.role}</p>
        </div>
        <button onClick={onClose} className="w-full mt-6 bg-white/10 text-white py-3 rounded-xl font-bold">إغلاق</button>
      </motion.div>
    </motion.div>
  );
}

function TeamDetailModal({ team, users, currentUser, onClose, onSuccess }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="glass-card rounded-3xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold gradient-text mb-6">{team.name}</h2>
        <div className="space-y-3">
          <p className="text-gray-300">المشرف: {team.supervisorName}</p>
          <p className="text-gray-300">عدد الأعضاء: {team.memberIds.length}</p>
        </div>
        <button onClick={onClose} className="w-full mt-6 bg-white/10 text-white py-3 rounded-xl font-bold">إغلاق</button>
      </motion.div>
    </motion.div>
  );
}

export default App;
