import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ApiResponseInterceptor } from './common/interceptors/response/response.interceptor.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ApiResponseInterceptor());

  const port = process.env.PORT ?? 3000;
  void app.listen(port);

  console.log(`Server running on port ${port}`);
}

void bootstrap();
