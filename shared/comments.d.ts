// أنواع قواعد الكومنتات (من shared/comments.js)
export type CommentActivityLike = {
  id?: string;
  type?: string;
  text?: string;
  at?: string;
  by?: string;
  status?: string;
  [key: string]: any;
};

export type CommentRecordLike = {
  activities?: CommentActivityLike[];
  [key: string]: any;
};

export type DailyFeedbackCardLike = {
  id?: string;
  clientPhone?: string;
  clientName?: string;
  feedback?: string;
  date?: string;
  createdAt?: string;
  status?: string;
  userId?: string;
  callStatus?: string;
  [key: string]: any;
};

export declare const COMMENT_TYPES: string[];
export declare const LOG_TYPES: string[];

export declare function cleanCommentText(value: any): string;
export declare function isSystemOnlyText(value: any): boolean;
export declare function isPureLogText(value: any): boolean;
export declare function isCallResultText(value: any): boolean;
export declare function isCommentActivity(activity: any): boolean;
export declare function commentSignature(text: any, at: any): string;
export declare function dedupeComments(items: any[]): any[];
export declare function commentActivitiesOf(client: any): any[];
export declare function sanitizeClientRecord<T>(client: T): T;
export declare function sanitizeDailyFeedbackCards(cards: any[]): any[];
