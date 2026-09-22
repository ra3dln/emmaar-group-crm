export interface Client {
  id: string;
  name: string;
  phone: string;
  property: string;
  budget: string;
  monthlyInstallment: string;
  deliveryPeriod: string;
  status: 'campaign' | 'facebook' | 'external';
  stage: 'new' | 'contacted' | 'meeting' | 'negotiation' | 'closed' | 'lost';
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
  area: string;
  price: string;
  location: string;
  description: string;
  image: string;
  clientPhone?: string;
  clientName?: string;
  createdAt: string;
}

export interface DailyFeedback {
  id: string;
  clientPhone: string;
  clientName: string;
  date: string;
  feedback: string;
  callStatus: 'called' | 'no-answer' | 'busy' | 'not-called';
  createdAt: string;
}

export type TabType = 'dashboard' | 'clients' | 'pipeline' | 'properties' | 'reminders' | 'daily-feedback';
