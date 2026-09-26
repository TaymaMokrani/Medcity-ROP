import { resolve } from 'path';
import { autostartTarget } from './ml-process.service';

function env(values: Record<string, string | undefined>) {
  return (key: string) => values[key];
}

const local = {
  ML_SERVICE_URL: 'http://127.0.0.1:8000',
  ML_SERVICE_AUTOSTART: 'true',
};

describe('autostartTarget', () => {
  it('starts a local service when asked to', () => {
    const target = autostartTarget(env(local), resolve('/app/backend/nest'));
    expect(target).toMatchObject({ host: '127.0.0.1', port: '8000' });
    expect(target?.cwd).toBe(resolve('/app/backend/fastapi'));
  });

  it('does nothing when autostart is off', () => {
    expect(
      autostartTarget(env({ ...local, ML_SERVICE_AUTOSTART: 'false' })),
    ).toBeNull();
    expect(
      autostartTarget(env({ ML_SERVICE_URL: local.ML_SERVICE_URL })),
    ).toBeNull();
  });

  it('does nothing when there is no ML service configured at all', () => {
    expect(autostartTarget(env({ ML_SERVICE_AUTOSTART: 'true' }))).toBeNull();
  });

  it('never starts a process for a service on another host', () => {
    for (const url of [
      'http://ml.internal:8000',
      'https://ml.medcity.com',
      'http://10.0.0.4:8000',
    ]) {
      expect(
        autostartTarget(env({ ...local, ML_SERVICE_URL: url })),
      ).toBeNull();
    }
  });

  it('survives a malformed url instead of crashing the gateway', () => {
    expect(
      autostartTarget(env({ ...local, ML_SERVICE_URL: 'not a url' })),
    ).toBeNull();
  });

  it('takes the interpreter and directory from the environment', () => {
    const target = autostartTarget(
      env({
        ...local,
        ML_SERVICE_PYTHON: 'C:/envs/vessel_v2/python.exe',
        ML_SERVICE_DIR: resolve('/somewhere/fastapi'),
      }),
    );
    expect(target?.python).toBe('C:/envs/vessel_v2/python.exe');
    expect(target?.cwd).toBe(resolve('/somewhere/fastapi'));
  });

  it('defaults the port when the url omits it', () => {
    const target = autostartTarget(
      env({ ...local, ML_SERVICE_URL: 'http://localhost' }),
    );
    expect(target?.port).toBe('8000');
  });
});
