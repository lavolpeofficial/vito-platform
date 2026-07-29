import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('gibt status ok zurück', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('vito-api');
    expect(typeof result.timestamp).toBe('string');
  });
});
