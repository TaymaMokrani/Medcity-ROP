import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

export interface AutostartTarget {
  url: string;
  python: string;
  cwd: string;
  host: string;
  port: string;
}

export function autostartTarget(
  read: (key: string) => string | undefined,
  cwd = process.cwd(),
): AutostartTarget | null {
  const url = read('ML_SERVICE_URL');
  if (!url) return null;
  if ((read('ML_SERVICE_AUTOSTART') ?? '').toLowerCase() !== 'true')
    return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return null;

  return {
    url: url.replace(/\/$/, ''),
    python: read('ML_SERVICE_PYTHON') || 'python',
    cwd: resolve(read('ML_SERVICE_DIR') || join(cwd, '..', 'fastapi')),
    host: parsed.hostname,
    port: parsed.port || '8000',
  };
}

const READY_TIMEOUT_MS = 120_000;
const POLL_MS = 500;

@Injectable()
export class MlProcessService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('MlService');
  private child?: ChildProcess;

  constructor(private readonly config: ConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    const target = autostartTarget((key) => this.config.get<string>(key));
    if (!target) return;

    if (await this.isHealthy(target.url)) {
      this.logger.log('ML service already running, leaving it alone');
      return;
    }

    if (!existsSync(join(target.cwd, 'app', 'main.py'))) {
      this.logger.error(
        `Cannot start the ML service: ${target.cwd} does not look like the ` +
          'service directory. Set ML_SERVICE_DIR, or start it yourself.',
      );
      return;
    }

    this.spawn(target);
    await this.waitUntilReady(target.url);
  }

  onApplicationShutdown(): void {
    if (!this.child?.pid || this.child.exitCode !== null) return;

    this.logger.log('stopping the ML service');
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      this.child.kill('SIGTERM');
    }
    this.child = undefined;
  }

  private spawn(target: AutostartTarget): void {
    this.logger.log(`starting the ML service in ${target.cwd}`);

    this.child = spawn(
      target.python,
      [
        '-m',
        'uvicorn',
        'app.main:app',
        '--host',
        target.host,
        '--port',
        target.port,
      ],
      { cwd: target.cwd, windowsHide: true },
    );

    const relay = (data: Buffer) => {
      data
        .toString()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => this.logger.log(line));
    };
    this.child.stdout?.on('data', relay);
    this.child.stderr?.on('data', relay);

    this.child.on('error', (error) => {
      this.logger.error(
        `could not start the ML service (${target.python}): ${error.message}. ` +
          'Set ML_SERVICE_PYTHON to an interpreter that has its dependencies.',
      );
    });
    this.child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        this.logger.error(`ML service exited with code ${code}`);
      }
      this.child = undefined;
    });
  }

  private async isHealthy(url: string): Promise<boolean> {
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitUntilReady(url: string): Promise<void> {
    const started = Date.now();

    while (Date.now() - started < READY_TIMEOUT_MS) {
      if (await this.isHealthy(url)) {
        this.logger.log(
          `ML service ready in ${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
        return;
      }
      if (!this.child) return;
      await new Promise((done) => setTimeout(done, POLL_MS));
    }

    this.logger.warn(
      'ML service did not become ready in time; screenings will fail until it does',
    );
  }
}
