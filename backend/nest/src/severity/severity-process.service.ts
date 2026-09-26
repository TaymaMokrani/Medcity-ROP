import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  autostartTarget,
  type AutostartTarget,
} from '../ml/ml-process.service';

const POLL_MS = 1000;
const READY_TIMEOUT_MS = 180_000;

/**
 * Reads the SEVERITY_* environment under the names `autostartTarget` expects, so
 * the rule for when a gateway may start a service itself is written once and
 * both services obey the same one.
 */
export function severityAutostartTarget(
  read: (key: string) => string | undefined,
  cwd = process.cwd(),
): AutostartTarget | null {
  const aliases: Record<string, string> = {
    ML_SERVICE_URL: 'SEVERITY_SERVICE_URL',
    ML_SERVICE_AUTOSTART: 'SEVERITY_SERVICE_AUTOSTART',
    ML_SERVICE_PYTHON: 'SEVERITY_SERVICE_PYTHON',
    ML_SERVICE_DIR: 'SEVERITY_SERVICE_DIR',
  };
  const target = autostartTarget(
    (key) =>
      read(aliases[key] ?? key) ??
      (key === 'ML_SERVICE_DIR'
        ? join(cwd, '..', 'fastapi-phase2')
        : undefined),
    cwd,
  );
  return target;
}

/**
 * Runs the severity service alongside the gateway in development.
 *
 * Two differences from the Phase 1 service, both of which matter:
 *
 *   it is started with `python -u`. The severity service loads torch and cv2,
 *   which ship different OpenMP builds; when the guard fails the process aborts
 *   with no traceback, and without `-u` the last log line before it is lost too.
 *
 *   the gateway does not wait for it. Two segmentation models and LoFTR take
 *   the best part of a minute to reach the GPU, and there is no reason for the
 *   rest of the app to be unavailable while they do. Severity requests answer
 *   503 until it is ready, which is the truth.
 */
@Injectable()
export class SeverityProcessService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('SeverityService');
  private child?: ChildProcess;

  constructor(private readonly config: ConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    const target = severityAutostartTarget((key) =>
      this.config.get<string>(key),
    );
    if (!target) return;

    if (await this.isHealthy(target.url)) {
      this.logger.log('severity service already running, leaving it alone');
      return;
    }

    if (!existsSync(join(target.cwd, 'app', 'main.py'))) {
      this.logger.error(
        `Cannot start the severity service: ${target.cwd} does not look like ` +
          'the service directory. Set SEVERITY_SERVICE_DIR, or start it yourself.',
      );
      return;
    }

    this.spawn(target);
    void this.reportWhenReady(target.url);
  }

  onApplicationShutdown(): void {
    if (!this.child?.pid || this.child.exitCode !== null) return;

    this.logger.log('stopping the severity service');
    // on Windows a plain kill leaves the python process behind
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
    this.logger.log(`starting the severity service in ${target.cwd}`);

    this.child = spawn(
      target.python,
      // -u: an OpenMP abort is silent otherwise, and looks like a hang
      [
        '-u',
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
        `could not start the severity service (${target.python}): ` +
          `${error.message}. SEVERITY_SERVICE_PYTHON must point at the ` +
          'interpreter that has torch, kornia and opencv.',
      );
    });
    this.child.on('exit', (code) => {
      if (code === 3) {
        this.logger.error(
          'severity service aborted with code 3 — two OpenMP runtimes loaded. ' +
            'app/__init__.py must import rop.ompfix before anything reaches torch.',
        );
      } else if (code !== 0 && code !== null) {
        this.logger.error(`severity service exited with code ${code}`);
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

  private async reportWhenReady(url: string): Promise<void> {
    const started = Date.now();

    while (Date.now() - started < READY_TIMEOUT_MS) {
      if (await this.isHealthy(url)) {
        this.logger.log(
          `severity service ready in ${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
        return;
      }
      if (!this.child) return; // it died; the exit handler has already said so
      await new Promise((done) => setTimeout(done, POLL_MS));
    }

    this.logger.warn(
      'severity service did not become ready; grading will fail until it does',
    );
  }
}
