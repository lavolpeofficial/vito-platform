import { Global, Module } from '@nestjs/common';
import { TenantContext } from './tenant/tenant-context';

@Global()
@Module({
  providers: [TenantContext],
  exports: [TenantContext],
})
export class CommonModule {}
