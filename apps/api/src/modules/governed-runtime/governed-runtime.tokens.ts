/**
 * Serverseitiger Workspace-Root der governed Runtime. Fehlt oder ist
 * unsicher (relativ), schlägt die Modul-Assembly beim Start fehl —
 * niemals cwd/$HOME/tmp-Fallbacks.
 */
export const GOVERNED_WORKSPACE_ROOT = 'GOVERNED_WORKSPACE_ROOT';

/** Produktiver Adapter-Registry-Token (exakt ein produktiver Adapter). */
export const GOVERNED_ADAPTER_REGISTRY = 'GOVERNED_ADAPTER_REGISTRY';
