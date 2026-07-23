export interface TelegramMessageFrom {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramMessageChat {
  id: number;
  type: string;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TelegramMessage {
  message_id: number;
  from: TelegramMessageFrom;
  chat: TelegramMessageChat;
  text?: string;
  entities?: TelegramMessageEntity[];
  date: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
