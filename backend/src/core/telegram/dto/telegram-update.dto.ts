import {
  IsInt,
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TelegramMessageFrom {
  @IsInt()
  id!: number;

  @IsBoolean()
  is_bot!: boolean;

  @IsString()
  first_name!: string;

  @IsOptional()
  @IsString()
  username?: string;
}

export class TelegramMessageChat {
  @IsInt()
  id!: number;

  @IsString()
  type!: string;
}

export class TelegramMessageEntity {
  @IsString()
  type!: string;

  @IsInt()
  offset!: number;

  @IsInt()
  length!: number;
}

export class TelegramMessage {
  @IsInt()
  message_id!: number;

  @ValidateNested()
  @Type(() => TelegramMessageFrom)
  from!: TelegramMessageFrom;

  @ValidateNested()
  @Type(() => TelegramMessageChat)
  chat!: TelegramMessageChat;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TelegramMessageEntity)
  entities?: TelegramMessageEntity[];

  @IsInt()
  date!: number;
}

export class TelegramCallbackQueryFrom {
  @IsInt()
  id!: number;
}

export class TelegramCallbackQueryMessage {
  @ValidateNested()
  @Type(() => TelegramMessageChat)
  chat!: TelegramMessageChat;

  @IsInt()
  message_id!: number;
}

export class TelegramCallbackQuery {
  @IsString()
  id!: string;

  @ValidateNested()
  @Type(() => TelegramCallbackQueryFrom)
  from!: TelegramCallbackQueryFrom;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramCallbackQueryMessage)
  message?: TelegramCallbackQueryMessage;

  @IsOptional()
  @IsString()
  data?: string;
}

export class TelegramUpdate {
  @IsInt()
  update_id!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramMessage)
  message?: TelegramMessage;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramCallbackQuery)
  callback_query?: TelegramCallbackQuery;
}
