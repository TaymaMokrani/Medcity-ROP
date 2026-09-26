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
import { createReadStream, existsSync } from 'fs';
import { basename, extname, join } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AccessService } from '../access/access.service';
import { UPLOAD_DIR, URL_PREFIX } from '../detections/upload.config';
import {
  SEVERITY_UPLOAD_DIR,
  SEVERITY_URL_PREFIX,
} from '../detections/severity-storage';

/** The two folders this route will serve from, and the URL each one answers to. */
const FOLDERS = {
  detections: { dir: UPLOAD_DIR, prefix: URL_PREFIX },
  severity: { dir: SEVERITY_UPLOAD_DIR, prefix: SEVERITY_URL_PREFIX },
} as const;

type FolderName = keyof typeof FOLDERS;

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

/**
 * Retinal photographs and rendered evidence.
 *
 * These files used to be served by `useStaticAssets`, which asks for no token
 * and knows no owner: anyone who had a URL — or guessed one — could download
 * a patient's retina. Every other route in this gateway is scoped to the
 * doctor who owns the record. This one now is too.
 *
 * Two checks, both needed. The guard establishes who is asking. The grant
 * establishes that this file was written for them. A file with no grant is
 * served to nobody, so a file that arrives on disk by any route other than an
 * upload is unreachable rather than public.
 *
 * `basename` pins the target inside the folder whatever the request contains,
 * so `..%2f..%2f.env` resolves to a filename and misses.
 */
@ApiTags('files')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly access: AccessService) {}

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
    const target = FOLDERS[folder as FolderName];
    if (!target) throw new NotFoundException('No such file');

    const filename = basename(name);
    await this.access.require('file', `${target.prefix}${filename}`, user.id);

    const path = join(target.dir, filename);
    if (!existsSync(path)) throw new NotFoundException('No such file');

    return new StreamableFile(createReadStream(path), {
      type:
        CONTENT_TYPES[extname(filename).toLowerCase()] ??
        'application/octet-stream',
    });
  }
}
