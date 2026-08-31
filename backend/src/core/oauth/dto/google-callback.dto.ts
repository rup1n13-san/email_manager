import { IsString } from 'class-validator';

export class GoogleCallbackDto {
  @IsString()
  code!: string;

  @IsString()
  state!: string;
}
