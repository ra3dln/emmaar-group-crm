import { Client, Reminder, Property, DailyFeedback, User, Team } from './types';

const CLIENTS_KEY = 'crm_clients';
const REMINDERS_KEY = 'crm_reminders';
const NOTIFIED_KEY = 'crm_notified_reminders';
const PROPERTIES_KEY = 'crm_properties';
const DAILY_FEEDBACK_KEY = 'crm_daily_feedback';
const USERS_KEY = 'crm_users';

export function getClients(): Client[] {
  const data = localStorage.getItem(CLIENTS_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveClients(clients: Client[]): void {
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
}

export function getReminders(): Reminder[] {
  const data = localStorage.getItem(REMINDERS_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveReminders(reminders: Reminder[]): void {
  localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
}

export function getNotifiedReminders(): string[] {
  const data = localStorage.getItem(NOTIFIED_KEY);
  return data ? JSON.parse(data) : [];
}

export function addNotifiedReminder(id: string): void {
  const notified = getNotifiedReminders();
  if (!notified.includes(id)) {
    notified.push(id);
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified));
  }
}

export function clearNotifiedReminders(): void {
  localStorage.removeItem(NOTIFIED_KEY);
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    return false;
  }
  
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered');
    } catch (error) {
      console.log('Service Worker registration failed:', error);
    }
  }
  
  if (Notification.permission === 'granted') {
    return true;
  }
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
}

export function sendNotification(title: string, body: string, tag?: string): void {
  if (Notification.permission === 'granted') {
    const notification = new Notification(title, {
      body,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%2306b6d4" width="100" height="100" rx="20"/><text x="50" y="70" font-size="60" text-anchor="middle" fill="white">🏠</text></svg>',
      badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%238b5cf6" width="100" height="100" rx="20"/><text x="50" y="70" font-size="60" text-anchor="middle" fill="white">🔔</text></svg>',
      tag: tag || 'crm-reminder',
      requireInteraction: true,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

export function playNotificationSound(): void {
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
}

export function vibrateDevice(): void {
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200, 100, 200]);
  }
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isReminderDue(reminder: Reminder): boolean {
  if (reminder.isCompleted) return false;
  return new Date(reminder.dateTime) <= new Date();
}

export function getTimeUntil(reminder: Reminder): string {
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
}

export function getProperties(): Property[] {
  const data = localStorage.getItem(PROPERTIES_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveProperties(properties: Property[]): void {
  localStorage.setItem(PROPERTIES_KEY, JSON.stringify(properties));
}

export function getDailyFeedbacks(): DailyFeedback[] {
  const data = localStorage.getItem(DAILY_FEEDBACK_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveDailyFeedbacks(feedbacks: DailyFeedback[]): void {
  localStorage.setItem(DAILY_FEEDBACK_KEY, JSON.stringify(feedbacks));
}

export function formatPrice(price: string): string {
  if (!price) return '0';
  const cleanPrice = price.replace(/[,\s]/g, '');
  const num = parseFloat(cleanPrice);
  if (isNaN(num)) return price;
  return num.toLocaleString('en-US');
}

export function parsePrice(price: string): number {
  if (!price) return 0;
  const arabicNumbers: Record<string, number> = {
    'مليون': 1000000,
    'مليونين': 2000000,
    'مليوني': 2000000,
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
}

// User Management functions
export function getUsers(): User[] {
  const data = localStorage.getItem(USERS_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveUsers(users: User[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function addUser(user: Omit<User, 'id' | 'createdAt'>): User {
  const users = getUsers();
  const newUser: User = {
    ...user,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  saveUsers([...users, newUser]);
  return newUser;
}

export function updateUser(id: string, data: Partial<User>): void {
  const users = getUsers();
  const updated = users.map(u => u.id === id ? { ...u, ...data } : u);
  saveUsers(updated);
}

export function deleteUser(id: string): void {
  const users = getUsers();
  saveUsers(users.filter(u => u.id !== id));
}

export function getUserById(id: string): User | undefined {
  return getUsers().find(u => u.id === id);
}

export function getCurrentUser(): User | null {
  const data = localStorage.getItem('current_user');
  return data ? JSON.parse(data) : null;
}

export function setCurrentUser(user: User | null): void {
  if (user) {
    localStorage.setItem('current_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('current_user');
  }
}

export function isAdmin(user: User): boolean {
  return user.role === 'admin';
}

export function isSupervisor(user: User): boolean {
  return user.role === 'supervisor';
}

export function isSales(user: User): boolean {
  return user.role === 'sales';
}

export function canManageUsers(user: User): boolean {
  return user.role === 'admin' || user.role === 'supervisor';
}

export function canViewAllData(user: User): boolean {
  return user.role === 'admin';
}

export function canViewTeamData(user: User): boolean {
  return user.role === 'admin' || user.role === 'supervisor';
}

// Team Management functions
const TEAMS_KEY = 'crm_teams';

export function getTeams(): Team[] {
  const data = localStorage.getItem(TEAMS_KEY);
  return data ? JSON.parse(data) : [];
}

export function saveTeams(teams: Team[]): void {
  localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
}

export function addTeam(team: Omit<Team, 'id' | 'createdAt'>): Team {
  const teams = getTeams();
  const newTeam: Team = {
    ...team,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  saveTeams([...teams, newTeam]);
  return newTeam;
}

export function updateTeam(id: string, data: Partial<Team>): void {
  const teams = getTeams();
  const updated = teams.map(t => t.id === id ? { ...t, ...data } : t);
  saveTeams(updated);
}

export function deleteTeam(id: string): void {
  const teams = getTeams();
  saveTeams(teams.filter(t => t.id !== id));
}

export function getTeamById(id: string): Team | undefined {
  return getTeams().find(t => t.id === id);
}

export function getTeamBySupervisor(supervisorId: string): Team | undefined {
  return getTeams().find(t => t.supervisorId === supervisorId);
}

// Client Assignment functions
export function assignClientToUser(clientId: string, userId: string): void {
  const clients = getClients();
  const updated = clients.map(c => 
    c.id === clientId ? { ...c, assignedTo: userId, updatedAt: new Date().toISOString() } : c
  );
  saveClients(updated);
}

export function assignClientsToUser(clientIds: string[], userId: string): void {
  const clients = getClients();
  const updated = clients.map(c => 
    clientIds.includes(c.id) ? { ...c, assignedTo: userId, updatedAt: new Date().toISOString() } : c
  );
  saveClients(updated);
}

export function distributeClientsEqually(clientIds: string[], userIds: string[]): void {
  const clients = getClients();
  const unassigned = clientIds.map(id => clients.find(c => c.id === id)).filter(Boolean) as Client[];
  
  userIds.forEach((userId, index) => {
    const clientsForUser = unassigned.filter((_, i) => i % userIds.length === index);
    const updated = clients.map(c => 
      clientsForUser.find(uc => uc.id === c.id) 
        ? { ...c, assignedTo: userId, updatedAt: new Date().toISOString() }
        : c
    );
    saveClients(updated);
  });
}

export function getClientsByUser(userId: string): Client[] {
  return getClients().filter(c => c.assignedTo === userId);
}

export function getClientsByTeam(teamId: string): Client[] {
  const team = getTeamById(teamId);
  if (!team) return [];
  return getClients().filter(c => team.memberIds.includes(c.assignedTo || ''));
}

// Reporting functions
export function getUserStats(userId: string) {
  const clients = getClientsByUser(userId);
  const feedbacks = getDailyFeedbacks().filter(f => f.userId === userId);
  
  return {
    totalClients: clients.length,
    newClients: clients.filter(c => c.stage === 'new').length,
    contactedClients: clients.filter(c => c.stage === 'contacted').length,
    meetingClients: clients.filter(c => c.stage === 'meeting').length,
    negotiationClients: clients.filter(c => c.stage === 'negotiation').length,
    closedClients: clients.filter(c => c.stage === 'closed').length,
    lostClients: clients.filter(c => c.stage === 'lost').length,
    conversionRate: clients.length > 0 
      ? ((clients.filter(c => c.stage === 'closed').length / clients.length) * 100).toFixed(1)
      : '0',
    totalCalls: feedbacks.filter(f => f.callStatus === 'called').length,
    noAnswerCalls: feedbacks.filter(f => f.callStatus === 'no-answer').length,
    busyCalls: feedbacks.filter(f => f.callStatus === 'busy').length,
  };
}

export function getTeamStats(teamId: string) {
  const team = getTeamById(teamId);
  if (!team) return null;
  
  const members = team.memberIds.map(id => getUserById(id)).filter(Boolean) as User[];
  const memberStats = members.map(member => ({
    user: member,
    stats: getUserStats(member.id),
  }));
  
  return {
    team,
    members: memberStats,
    totalClients: memberStats.reduce((sum, m) => sum + m.stats.totalClients, 0),
    totalClosed: memberStats.reduce((sum, m) => sum + m.stats.closedClients, 0),
    totalCalls: memberStats.reduce((sum, m) => sum + m.stats.totalCalls, 0),
  };
}

export function getAllUsersStats() {
  const users = getUsers().filter(u => u.isActive);
  return users.map(user => ({
    user,
    stats: getUserStats(user.id),
  }));
}
