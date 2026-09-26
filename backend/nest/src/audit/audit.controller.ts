import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AuditService } from './audit.service';

/**
 * Your own activity. Read only — there is no route that writes here, and no
 * route that returns anyone else's.
 */
@ApiTags('activity')
@ApiBearerAuth()
@Controller('activity')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.audit.list(
      user.id,
      Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
    );
  }
}
