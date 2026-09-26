import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const SERVER_ERROR = 500;

interface ErrorBody {
  statusCode: number;
  message: string;
  error: string;
  path: string;
  timestamp: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ErrorBody = {
      statusCode: status,
      message: this.messageFor(exception, status),
      error: this.nameFor(exception, status),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    const where = `${request.method} ${request.url}`;
    if (status >= SERVER_ERROR) {
      this.logger.error(
        `${where} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${where} -> ${status} ${body.message}`);
    }

    response.status(status).json(body);
  }

  private messageFor(exception: unknown, status: number): string {
    if (!(exception instanceof HttpException)) {
      return 'Internal server error';
    }

    const payload = exception.getResponse();
    if (typeof payload === 'string') return payload;

    const message = (payload as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join('; ');
    if (typeof message === 'string') return message;

    return status >= SERVER_ERROR ? 'Internal server error' : exception.message;
  }

  private nameFor(exception: unknown, status: number): string {
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null) {
        const error = (payload as { error?: unknown }).error;
        if (typeof error === 'string') return error;
      }
    }
    return HttpStatus[status] ?? 'Error';
  }
}
