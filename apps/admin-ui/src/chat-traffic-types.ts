import type { PageResult } from "./types";

export interface ChatTrafficOverview {
  totalBytes: number;
  daily: Array<{
    date: string;
    bytes: number;
    hourlyBytes: number[];
  }>;
}
export type TrafficApi = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface UserChatTraffic {
  id: string;
  email: string;
  totalBytes: number;
  monthBytes: number;
  monthUsedBytes: number;
  monthlyLimitBytes: number;
  resetAt: string;
}

export interface UserChatTrafficDetail extends ChatTrafficOverview { user: UserChatTraffic }

export interface UserChatTrafficSummary {
  monthBytes: number;
  totalBytes: number;
  monthActiveUsers: number;
  totalActiveUsers: number;
}

export interface UserChatTrafficList extends PageResult<UserChatTraffic> {
  summary: UserChatTrafficSummary;
}
