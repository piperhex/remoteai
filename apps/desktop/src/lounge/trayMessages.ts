export interface TrayMessage {
  key: string;
  senderId: string;
  sentAt: string;
  text: string;
  imageCount: number;
}

export interface TraySender {
  name: string;
  avatar?: string;
}

export interface TrayMessages {
  messages: TrayMessage[];
  senders: Record<string, TraySender>;
}

export interface TraySnapshot extends TrayMessages {
  revision: number;
}

export type TrayAction =
  | { type: 'ignore' | 'dismiss' }
  | { type: 'viewAll' }
  | { type: 'open'; key: string };
