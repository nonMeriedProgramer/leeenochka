export type IntentType = 'event' | 'task' | 'note' | 'query' | 'unknown';

export interface ParsedIntent {
  type: IntentType;
  title: string;
  description?: string;
  datetime?: string;       // ISO 8601
  duration?: number;       // minutes
  project?: string;
  priority?: 'high' | 'medium' | 'low';
  deadline?: string;       // ISO 8601 date
  clarificationNeeded?: string;
}

export interface UserPreferences {
  workingHoursStart: number;  // 9
  workingHoursEnd: number;    // 18
  lunchStart: number;         // 12
  lunchEnd: number;           // 13
  deepWorkHours: number[];    // [9, 10, 11]
  timezone: string;           // 'Europe/Kyiv'
}

export interface UserState {
  telegramId: number;
  googleTokens?: {
    access_token: string;
    refresh_token: string;
    expiry_date: number;
  };
  preferences: UserPreferences;
  pendingConfirmation?: ParsedIntent;
}

export interface ProjectMapping {
  name: string;
  notionDatabaseId: string;
  keywords: string[];
}
