import { Injectable } from '@nestjs/common';
import {
  ProviderType,
  GovernedProviderAdapter,
  AdapterRegistration,
  GovernedAdapterRegistry,
} from '@vito/contracts';

@Injectable()
export class GovernedAdapterRegistryImpl implements GovernedAdapterRegistry {
  private readonly adapters = new Map<ProviderType, GovernedProviderAdapter>();

  register(registration: AdapterRegistration): void {
    this.adapters.set(registration.providerType, registration.adapter);
  }

  get(providerType: ProviderType): GovernedProviderAdapter | undefined {
    return this.adapters.get(providerType);
  }

  has(providerType: ProviderType): boolean {
    return this.adapters.has(providerType);
  }

  getSupportedProviderTypes(): readonly ProviderType[] {
    return Array.from(this.adapters.keys());
  }
}