import { Module } from '@nestjs/common';
import { parseServerCredentialsFromEnv, ServerCredentialResolver } from './server-credential.resolver';

@Module({
  providers: [
    {
      provide: ServerCredentialResolver,
      useFactory: (): ServerCredentialResolver =>
        new ServerCredentialResolver(parseServerCredentialsFromEnv(process.env.VITO_SERVER_CREDENTIALS)),
    },
  ],
  exports: [ServerCredentialResolver],
})
export class ServerCredentialsModule {}
