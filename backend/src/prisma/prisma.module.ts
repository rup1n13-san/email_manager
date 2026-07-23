import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { EncryptionHelper } from '../common/helpers/encryption.js';

@Global()
@Module({
  providers: [PrismaService, EncryptionHelper],
  exports: [PrismaService, EncryptionHelper],
})
export class PrismaModule {}
