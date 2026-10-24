export interface User {
  id: string;
  username: string;
  password: string;
  name: string;
  phone?: string;
  role: 'admin' | 'supervisor' | 'sales';
  // حساب «مطوّر»: رتبته إدارية (كل الصلاحيات وتعديل كلمات المرور) لكنه
  // يظهر في قائمة الحسابات كحساب سيلز عادي، وتظهر له قوائم السيلز والإدارة معاً.
  developer?: boolean;
  // «إداري وسيلز في نفس الوقت»: يبقى رتبته كما هي (يشتغل بالإدارة كالأصل)
  // ويستقبل أرقاماً أيضاً فيظهر في «توزيع الأرقام» ويقبل التوزيع اليدوي والتلقائي.
  // مستقل عن developer حتى لا يفتح قوائم المطوّر بلا داعٍ.
  receivesLeads?: boolean;
  // نطاق البيانات: 'own' = بياناته هو فقط (حتى لو رتبته إدارية)،
  // 'all' = كل بيانات الشركة. غير محدد = حسب الرتبة (الإدارة الكل، الباقي نفسه).
  // يُستخدم لحساب إداري يشتغل كسيلز (مثل حساب المطوّر) فلا يرى أرقام غيره.
  dataScope?: 'own' | 'all';
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

// حدث في الخط الزمني للعميل: يُسجَّل داخل سجل العميل نفسه ليسافر مع المزامنة
// (إضافة، تغيير مرحلة، تذكير، فيدباك، واتساب، وصول من الرابط العام…)
export interface ClientActivity {
  id: string;
  type: string;
  text: string;
  at: string;
  by?: string;
  // حالة الفيدباك المختارة من الشريط (follow up / meeting / done deal …) — اختيارية
  // حتى تبقى الأحداث القديمة التي لا حالة لها صالحة كما هي.
  status?: string;
  // سبب الإلغاء عند اختيار حالة «cancellation» (not-interested / low-budget / …)
  cancelReason?: string;
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
  // اسم فورم الكامبين الذي جاء منه الرقم (للعرض في «عملاء كامبين»)
  formName?: string;
  // وقت تسجيل الرقم في الكامبين (وقت نزوله في الفورم) — مش وقت إضافته في النظام
  campaignAt?: string;
  // آخر سبب إلغاء اختاره المندوب — أساس فلتر الإلغاء في قائمة العملاء
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
  activities?: ClientActivity[];
}

// هدف الاتصال: عميل مسجّل، أو رقم موزَّع لسه مش عميل.
// الرقم الموزَّع بيتسجَّل بمعرّفه المشتق من الرقم (نفس قاعدة العميل التلقائي)
// فالسجلات بتتدمج على كل الأجهزة بدل ما تتكرر.
export interface CallTarget {
  id: string;
  name: string;
  phone: string;
  stage?: Client['stage'];
  // الرقم الموزَّع لسه مش عميل مسجّل: المكالمة بتتسجَّل برقمه (مفيش خط زمني لعميل)
  virtualLead?: boolean;
}

export interface AssignedLead {
  id: string;
  adminId: string;
  salesId: string;
  name: string;
  phone: string;
  description: string;
  status: 'new' | 'viewed' | 'contacted' | 'closed';
  viewedAt?: string;
  createdAt: string;
  // وقت توزيع الرقم على المندوب (غير وقت وصوله) — إشعار «رقم جديد نزل» يُحسب منه
  assignedAt?: string;
  // اسم الفورم الذي نزل منه الرقم — يُكتب جمب الرقم في كل القوائم
  formName?: string;
  // وقت تسجيل الرقم في الكامبين (وقت نزوله في الفورم) — مش وقت استيراده
  campaignAt?: string;
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
  images?: string[]; // صور الوحدة (مضغوطة ومحفوظة داخل قاعدة البيانات نفسها)
  latitude?: number; // موقع الوحدة على الخريطة
  longitude?: number;
  clientPhone?: string;
  clientPhone2?: string; // رقم تاني اختياري (مالك العقار أو عميل مهتم)
  clientName?: string;
  project?: string;
  compound?: string;
  floor?: string;
  rooms?: string;
  bathrooms?: string;
  finishing: 'fully-finished' | 'semi-finished' | 'core-and-shell';
  delivery: 'immediate' | 'delayed';
  // نطاق الظهور: 'team' = لكل الفريق (الافتراضي)، 'private' = خاصة بصاحبها والإدارة
  scope?: 'team' | 'private';
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
  // حالة الفيدباك (نفس الشريط) — تظهر في تبويب «الفيدباك»
  status?: string;
  duration?: string;
  nextAction?: string;
  createdAt: string;
}

export interface Attendance {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD (يوم الحضور)
  checkInAt: string; // ISO timestamp كامل وقت تسجيل الحضور
  latitude: number;
  longitude: number;
  accuracy: number; // دقة إشارة الـ GPS بالمتر
  checkOutAt?: string; // وقت الانصراف
  checkOutLatitude?: number;
  checkOutLongitude?: number;
  checkOutAccuracy?: number;
  createdAt: string;
  updatedAt?: string;
  // مؤشرات اشتباه في الموقع (Fake GPS / VPN) — تُعرض للإدارة كتحذير أحمر
  flags?: string[];
}

// سجل مكالمة: يكتبه السيلز بعد كل اتصال (تم الرد / لم يرد + كومنت + موعد الاتصال القادم)
// ويُزامَن ليظهر للإدارة في مركز الإشعارات وتبويب الفيدباك.
export interface CallLog {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  salesId: string;
  salesName: string;
  result: 'answered' | 'no-answer';
  comment: string;
  nextCallAt?: string;
  createdAt: string;
}

// رسالة في الشات الداخلي بين الإدارة وأي حساب سيلز
export interface ChatMessage {
  id: string;
  fromId: string; // مُرسِل الرسالة
  fromName: string; // اسمه وقت الإرسال (حتى يظهر في المحادثة)
  toId: string; // المُستقبِل
  text: string;
  createdAt: string;
  readAt?: string; // وقت قراءتها من المستقبل (للمحادثات الفردية)
  readBy?: string[]; // من قرأها — تُستخدم في غرفة المدراء الجماعية
}

export type TabType = 'dashboard' | 'clients' | 'admin-clients' | 'admin-forms' | 'pipeline' | 'properties' | 'reminders' | 'daily-feedback' | 'new-leads' | 'reports' | 'chat' | 'admin-users' | 'admin-feedback' | 'admin-leads' | 'admin-attendance' | 'admin-analytics' | 'admin-chat' | 'admin-settings';
