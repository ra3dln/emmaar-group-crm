import { Client, Reminder } from './types';

const CLIENTS_KEY = 'crm_clients';
const REMINDERS_KEY = 'crm_reminders';
const NOTIFIED_KEY = 'crm_notified_reminders';

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
  // Create audio context for notification sound
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Play a pleasant notification melody
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
    // Play a pleasant ascending melody
    playTone(523.25, now, 0.2);        // C5
    playTone(659.25, now + 0.15, 0.2); // E5
    playTone(783.99, now + 0.3, 0.2);  // G5
    playTone(1046.50, now + 0.45, 0.4); // C6
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
