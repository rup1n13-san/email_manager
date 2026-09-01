import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GoogleCallbackDto {
  // Absent when the user denies consent — Google sends `error` instead.
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  code?: string;

  @IsString()
  @MaxLength(4096)
  state!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  error?: string;
}
