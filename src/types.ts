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

export type TabType = 'dashboard' | 'clients' | 'reminders' | 'add-client';
