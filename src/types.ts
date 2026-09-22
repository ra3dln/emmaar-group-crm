export interface User {
  id: string;
  username: string;
  password: string;
  name: string;
  phone?: string;
  role: 'admin' | 'supervisor' | 'sales';
  team?: string;
  isActive: boolean;
  createdAt: string;
  createdBy?: string;
}

export interface Team {
  id: string;
  name: string;
  supervisorId: string;
  supervisorName: string;
  memberIds: string[];
  createdAt: string;
  createdBy: string;
}

export interface Client {
  id: string;
  userId: string;
  name: string;
  phone: string;
  phones: string[];
  property: string;
  budget: string;
  monthlyInstallment: string;
  deliveryPeriod: string;
  status: 'campaign' | 'facebook' | 'external';
  stage: 'new' | 'contacted' | 'meeting' | 'negotiation' | 'closed' | 'lost';
  feedback: string;
  assignedTo?: string;
  priority: 'high' | 'medium' | 'low';
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssignedLead {
  id: string;
  adminId: string;
  salesId: string;
  name: string;
  phone: string;
  description: string;
  status: 'new' | 'contacted' | 'closed';
  createdAt: string;
}

export interface Reminder {
  id: string;
  userId: string;
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
  userId: string;
  name: string;
  type: string;
  area: string;
  price: string;
  priceNumeric: number;
  location: string;
  description: string;
  image: string;
  clientPhone?: string;
  clientName?: string;
  project?: string;
  compound?: string;
  floor?: string;
  rooms?: string;
  bathrooms?: string;
  finishing: 'fully-finished' | 'semi-finished' | 'core-and-shell';
  delivery: 'immediate' | 'delayed';
  createdAt: string;
}

export interface DailyFeedback {
  id: string;
  userId: string;
  clientPhone: string;
  clientName: string;
  date: string;
  feedback: string;
  callStatus: 'called' | 'no-answer' | 'busy' | 'not-called';
  duration?: string;
  nextAction?: string;
  createdAt: string;
}

export type TabType = 'dashboard' | 'clients' | 'pipeline' | 'properties' | 'reminders' | 'daily-feedback' | 'assigned-leads' | 'reports' | 'admin-users' | 'admin-teams' | 'admin-settings';
