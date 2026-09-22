export interface User {
  id: string;
  username: string;
  password: string;
  name: string;
  phone: string;
  role: 'admin' | 'supervisor' | 'sales';
  teamId?: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
}

export interface Client {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  property: string;
  budget: string;
  monthlyInstallment: string;
  deliveryPeriod: string;
  source: 'campaign' | 'facebook' | 'external';
  stage: 'new' | 'contacted' | 'meeting' | 'negotiation' | 'closed' | 'lost';
  priority: 'high' | 'medium' | 'low';
  feedback: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  ownerId: string;
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
  ownerId: string;
  name: string;
  type: string;
  area: string;
  price: string;
  priceNumeric: number;
  location: string;
  description: string;
  clientPhone?: string;
  clientName?: string;
  project?: string;
  rooms?: string;
  bathrooms?: string;
  finishing: 'fully-finished' | 'semi-finished' | 'core-and-shell';
  delivery: 'immediate' | 'delayed';
  createdAt: string;
}

export interface DailyFeedback {
  id: string;
  ownerId: string;
  clientPhone: string;
  clientName: string;
  date: string;
  feedback: string;
  callStatus: 'called' | 'no-answer' | 'busy' | 'not-called';
  duration?: string;
  nextAction?: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  supervisorId: string;
  memberIds: string[];
  createdAt: string;
}

export type TabType = 
  | 'dashboard' 
  | 'clients' 
  | 'pipeline' 
  | 'properties' 
  | 'reminders' 
  | 'daily-feedback' 
  | 'reports'
  | 'admin-panel'
  | 'create-account';
