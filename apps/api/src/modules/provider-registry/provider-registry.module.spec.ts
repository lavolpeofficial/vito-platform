import { MODULE_METADATA } from '@nestjs/common/constants';
import { ProviderRegistryController } from './provider-registry.controller';
import { ProviderRegistryModule } from './provider-registry.module';

describe('ProviderRegistryModule runtime wiring', () => {
  it('registers ProviderRegistryController so governed provider routes are mounted', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      ProviderRegistryModule,
    ) as unknown[] | undefined;

    expect(controllers).toContain(ProviderRegistryController);
  });
});
