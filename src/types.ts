export interface Client {
  id: string;
  name: string;
  phone: string;
  property: string;
  budget: string;
  monthlyInstallment: string;
  deliveryPeriod: string;
  status: 'campaign' | 'facebook' | 'external';
  feedback: string;
  createdAt: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  dateTime: string;
  note: string;
  isCompleted: boolean;
  isDelayed: boolean;
  delayCount: number;
  createdAt: string;
}

export interface Property {
  id: string;
  name: string;
  type: string;
  location: string;
  price: string;
  area: string;
  rooms: string;
  bathrooms: string;
  description: string;
  clientPhone: string;
  status: 'available' | 'reserved' | 'sold';
  createdAt: string;
  updatedAt: string;
}

export interface DailyFeedback {
  id: string;
  clientPhone: string;
  clientName: string;
  date: string;
  feedback: string;
  followUp: string;
  createdAt: string;
}

export type TabType = 'dashboard' | 'clients' | 'properties' | 'feedback' | 'reminders';
