import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
@UseGuards(JwtAuthGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  async findAll(@CurrentUser() user: AuthUser) {
    return this.patientsService.findAll(user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const patient = await this.patientsService.findOne(id, user.id);
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  @Post()
  async create(@Body() dto: CreatePatientDto, @CurrentUser() user: AuthUser) {
    return this.patientsService.create(dto, user.id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() user: AuthUser,
  ) {
    const patient = await this.patientsService.update(id, dto, user.id);
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const success = await this.patientsService.remove(id, user.id);
    if (!success) throw new NotFoundException('Patient not found');
    return { success: true };
  }
}
