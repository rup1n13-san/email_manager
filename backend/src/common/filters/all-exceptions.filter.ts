import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter, AbstractHttpAdapter } from '@nestjs/core';
import { Request } from 'express';

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(httpAdapter: AbstractHttpAdapter) {
    super(httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<Request>();
    const context = `${request?.method ?? 'UNKNOWN'} ${request?.originalUrl ?? 'UNKNOWN'}`;

    if (exception instanceof HttpException) {
      this.logger.warn(`${context} - ${exception.message}`);
    } else {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`${context} - Unhandled exception`, stack);
    }

    super.catch(exception, host);
  }
}
