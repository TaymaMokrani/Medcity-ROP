import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AccessService } from '../access/access.service';
import { StorageService } from '../storage/storage.service';
import { isSafeName, SERVED_FOLDERS, type ServedFolder } from '../storage/keys';

/**
 * Retinal photographs and rendered evidence, streamed from object storage.
 *
 * `GET /files/detections/<name>` serves the object whose key is
 * `detections/<name>` — the same string the screening record holds.
 *
 * The bucket is private, and this route is the only way in. Two checks, both
 * needed. The guard establishes who is asking. The grant establishes that this
 * file was written for them. A file with no grant is served to nobody, so an
 * object that reaches the bucket by any route other than an upload is
 * unreachable rather than public.
 *
 * The folder must be one of two known names and the file name one safe
 * segment, so `..%2f` or a slash in the name is refused before storage is asked.
 */
@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(
    private readonly access: AccessService,
    private readonly storage: StorageService,
  ) {}

  @Get(':folder/:name')
  // Patient images are never cached by a proxy and never written to disk by
  // the browser. The client keeps one copy in memory for as long as the tab
  // is open, which is where a cache belongs for this kind of file.
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async read(
    @Param('folder') folder: string,
    @Param('name') name: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    if (!SERVED_FOLDERS.includes(folder as ServedFolder) || !isSafeName(name)) {
      throw new NotFoundException('No such file');
    }

    const key = `${folder}/${name}`;
    await this.access.require('file', key, user.id);

    const file = await this.storage.open(key);
    return new StreamableFile(file.stream, {
      type: file.contentType,
      length: file.length,
    });
  }
}
