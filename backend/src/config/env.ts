import { registerAs } from '@nestjs/config';

export const envConfig = registerAs('env', () => ({
  isGlobal: true,
  envFilePath: '.env',
  validate: undefined,
}));
