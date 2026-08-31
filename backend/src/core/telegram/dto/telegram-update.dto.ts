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

export class TelegramUpdate {
  @IsInt()
  update_id!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramMessage)
  message?: TelegramMessage;
}
