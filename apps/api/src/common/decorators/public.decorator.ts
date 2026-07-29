import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Markiert einen Endpunkt als öffentlich zugänglich (kein JWT nötig).
 *
 * Gemäß Sprint-2-Vorgabe bleiben ausschließlich `GET /health` und
 * `POST /auth/login` öffentlich. Jeder neue öffentliche Endpunkt muss
 * bewusst mit diesem Decorator versehen werden — der globale
 * `JwtAuthGuard` schützt standardmäßig alles andere.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
