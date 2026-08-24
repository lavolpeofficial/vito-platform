import { promises as fs } from 'fs';
import * as path from 'path';
import {
  AgentExecutionStatus,
  ExecutionAction,
  ProviderType,
  type GovernedAdapterRequest,
  type GovernedAdapterResult,
  type GovernedExecutionContext,
  type GovernedProviderAdapter,
} from '@vito/contracts';

/**
 * WorkspaceFileToolAdapter (B2b) — der erste deterministische
 * GovernedProviderAdapter.
 *
 * Unterstützt AUSSCHLIESSLICH READ_FILE / CREATE_FILE / WRITE_FILE und
 * betreibt sich ausschließlich innerhalb von
 * context.environment.workingDirectory. Die Autorität kommt ausschließlich
 * aus dem bereits policy-geprüften Kontext (policyDecision.requestedAction /
 * requestedPath); request-Daten liefern nur den Dateiinhalt. Der Adapter
 * entscheidet NIEMALS Policy, startet KEINE Prozesse, nutzt KEIN Netz und
 * gibt KEINE Rohinhalte zurück — nur gov://-Referenzen und Side-Effect-
 * Metadaten gemäß dem eingefrorenen Normalisierungsvokabular des
 * EO-01.5-Dienstes (providerExecutionMetadata.sideEffects).
 */

const SUPPORTED_ACTIONS: readonly ExecutionAction[] = [
  ExecutionAction.READ_FILE,
  ExecutionAction.CREATE_FILE,
  ExecutionAction.WRITE_FILE,
];

const MAX_CONTENT_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 256 * 1024;

function isInsidePath(child: string, base: string): boolean {
  return child === base || child.startsWith(base + path.sep);
}

function toGovReference(relativePath: string): string {
  return `gov://workspace/${relativePath.split(path.sep).join('/')}`;
}

function failed(code: string, message: string): GovernedAdapterResult {
  return {
    status: AgentExecutionStatus.FAILED,
    providerExecutionMetadata: {},
    error: { code, message, retryable: false },
    completedAt: new Date(),
  };
}

export class WorkspaceFileToolAdapter implements GovernedProviderAdapter {
  readonly providerType = ProviderType.DETERMINISTIC_TOOL;

  async execute(
    request: GovernedAdapterRequest,
    context: GovernedExecutionContext,
  ): Promise<GovernedAdapterResult> {
    try {
      if (this.isExpired(context)) {
        return this.timedOut();
      }

      const action = context.policyDecision.requestedAction as ExecutionAction;
      if (!SUPPORTED_ACTIONS.includes(action)) {
        return failed('UNSUPPORTED_ACTION', `Workspace file tool does not support ${String(action)}`);
      }

      const requestedPath = context.policyDecision.requestedPath;
      if (!requestedPath || typeof requestedPath !== 'string') {
        return failed('TARGET_PATH_REQUIRED', 'File actions require an authoritative requestedPath');
      }

      // Confinement-Anker: das reale (dereferenzierte) governed Arbeitsverzeichnis.
      const baseReal = await fs.realpath(context.environment.workingDirectory);
      const targetAbs = path.resolve(baseReal, requestedPath);
      if (!isInsidePath(targetAbs, baseReal)) {
        return failed('PATH_ESCAPE', 'Requested target resolves outside the governed workspace');
      }

      // Symlink-Abwehr über Anker: nächstliegende existierende Vorfahren-
      // komponente dereferenzieren; jede Dereferenzierung muss im Root bleiben.
      let probe = targetAbs;
      while (!(await this.pathExists(probe))) {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
        if (!isInsidePath(probe, baseReal)) {
          return failed('PATH_ESCAPE', 'Requested parent chain leaves the governed workspace');
        }
        if (this.isExpired(context)) {
          return this.timedOut();
        }
      }
      const anchorReal = await fs.realpath(probe);
      if (!isInsidePath(anchorReal, baseReal)) {
        return failed('SYMLINK_ESCAPE', 'Existing path component escapes the governed workspace');
      }

      switch (action) {
        case ExecutionAction.READ_FILE:
          return await this.readFile(targetAbs, baseReal, context);
        case ExecutionAction.CREATE_FILE:
          return await this.createFile(request, targetAbs, baseReal, context);
        case ExecutionAction.WRITE_FILE:
          return await this.writeFile(request, targetAbs, baseReal, context);
        default:
          return failed('UNSUPPORTED_ACTION', 'Unhandled file action');
      }
    } catch (error) {
      const detail =
        error instanceof Error && 'code' in error
          ? String((error as { code: unknown }).code)
          : error instanceof Error
            ? error.name
            : 'UNKNOWN';
      return failed('FILE_TOOL_ERROR', `Workspace file operation failed (${detail})`);
    }
  }

  private isExpired(context: GovernedExecutionContext): boolean {
    return Date.now() - context.startedAt.getTime() >= context.timeoutMs;
  }

  private timedOut(): GovernedAdapterResult {
    return {
      status: AgentExecutionStatus.TIMED_OUT,
      providerExecutionMetadata: {},
      error: {
        code: 'ADAPTER_TIMEOUT',
        message: 'Workspace file tool exceeded its cooperative execution budget',
        retryable: false,
      },
      completedAt: new Date(),
    };
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.lstat(p);
      return true;
    } catch {
      return false;
    }
  }

  private extractContent(request: GovernedAdapterRequest):
    | { ok: true; bytes: Buffer }
    | { ok: false; code: string; message: string } {
    const payload = request.governedInputPayload as { content?: unknown } | undefined;
    const content = payload?.content;
    if (typeof content !== 'string') {
      return { ok: false, code: 'INVALID_CONTENT', message: 'content must be a string payload field' };
    }
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.byteLength > MAX_CONTENT_BYTES) {
      return { ok: false, code: 'CONTENT_TOO_LARGE', message: 'content exceeds the governed size limit' };
    }
    return { ok: true, bytes };
  }

  /** Dereferenzierungs-sichere Zielauflösung für existierende Dateien. */
  private async resolveExistingInside(
    targetAbs: string,
    baseReal: string,
  ): Promise<{ ok: true; realTarget: string } | { ok: false; result: GovernedAdapterResult }> {
    let st;
    try {
      st = await fs.lstat(targetAbs);
    } catch {
      return {
        ok: false,
        result: failed('FILE_NOT_FOUND', 'Target file does not exist inside the governed workspace'),
      };
    }
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        result: failed('SYMLINK_ESCAPE', 'Symbolic link targets are not permitted'),
      };
    }
    const realTarget = await fs.realpath(targetAbs);
    if (!isInsidePath(realTarget, baseReal)) {
      return {
        ok: false,
        result: failed('SYMLINK_ESCAPE', 'Resolved file escapes the governed workspace'),
      };
    }
    return { ok: true, realTarget };
  }

  private async readFile(
    targetAbs: string,
    baseReal: string,
    context: GovernedExecutionContext,
  ): Promise<GovernedAdapterResult> {
    const resolved = await this.resolveExistingInside(targetAbs, baseReal);
    if (!resolved.ok) return resolved.result;
    const handle = await fs.open(resolved.realTarget, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        return failed('FILE_TOOL_ERROR', 'Target is not a regular file');
      }
      if (stat.size > MAX_READ_BYTES) {
        return failed('READ_LIMIT_EXCEEDED', 'File exceeds the governed read limit');
      }
      const buffer = Buffer.alloc(stat.size);
      await handle.read(buffer, 0, stat.size, 0);
      if (this.isExpired(context)) {
        return this.timedOut();
      }
      const relativePath = path.relative(baseReal, resolved.realTarget);
      return {
        status: AgentExecutionStatus.SUCCEEDED,
        outputReference: toGovReference(relativePath),
        providerExecutionMetadata: {
          sideEffects: {
            filesCreated: [],
            filesModified: [],
            filesDeleted: [],
            commandsExecuted: [],
          },
        },
        usageMetadata: { bytes: stat.size },
        completedAt: new Date(),
      };
    } finally {
      await handle.close();
    }
  }

  private async createFile(
    request: GovernedAdapterRequest,
    targetAbs: string,
    baseReal: string,
    context: GovernedExecutionContext,
  ): Promise<GovernedAdapterResult> {
    const content = this.extractContent(request);
    if (!content.ok) return failed(content.code, content.message);

    const existing = await this.pathExists(targetAbs);
    if (existing) {
      const lstat = await fs.lstat(targetAbs);
      if (lstat.isSymbolicLink()) {
        return failed('SYMLINK_ESCAPE', 'Refusing to create through a symbolic link');
      }
      return failed('FILE_ALREADY_EXISTS', 'Exclusive creation requires a non-existing target');
    }

    const parent = path.dirname(targetAbs);
    await fs.mkdir(parent, { recursive: true });
    // Nach mkdir erneut verankern: das erzeugte Verzeichnis darf nicht durch
    // eine konkurrierende Symlink-Komponente aus dem Root geführt haben.
    const parentReal = await fs.realpath(parent);
    if (!isInsidePath(parentReal, baseReal)) {
      return failed('SYMLINK_ESCAPE', 'Created parent directory escapes the governed workspace');
    }

    const handle = await fs.open(path.join(parentReal, path.basename(targetAbs)), 'wx');
    try {
      await handle.write(content.bytes);
    } finally {
      await handle.close();
    }
    if (this.isExpired(context)) {
      return this.timedOut();
    }
    const relativePath = path.relative(baseReal, path.join(parentReal, path.basename(targetAbs)));
    return {
      status: AgentExecutionStatus.SUCCEEDED,
      artifactReferences: [toGovReference(relativePath)],
      providerExecutionMetadata: {
        sideEffects: {
          filesCreated: [relativePath.split(path.sep).join('/')],
          filesModified: [],
          filesDeleted: [],
          commandsExecuted: [],
        },
      },
      usageMetadata: { bytes: content.bytes.byteLength },
      completedAt: new Date(),
    };
  }

  private async writeFile(
    request: GovernedAdapterRequest,
    targetAbs: string,
    baseReal: string,
    context: GovernedExecutionContext,
  ): Promise<GovernedAdapterResult> {
    const content = this.extractContent(request);
    if (!content.ok) return failed(content.code, content.message);

    const resolved = await this.resolveExistingInside(targetAbs, baseReal);
    if (!resolved.ok) return resolved.result;

    const handle = await fs.open(resolved.realTarget, 'w');
    try {
      await handle.write(content.bytes);
    } finally {
      await handle.close();
    }
    if (this.isExpired(context)) {
      return this.timedOut();
    }
    const relativePath = path.relative(baseReal, resolved.realTarget);
    return {
      status: AgentExecutionStatus.SUCCEEDED,
      artifactReferences: [toGovReference(relativePath)],
      providerExecutionMetadata: {
        sideEffects: {
          filesCreated: [],
          filesModified: [relativePath.split(path.sep).join('/')],
          filesDeleted: [],
          commandsExecuted: [],
        },
      },
      usageMetadata: { bytes: content.bytes.byteLength },
      completedAt: new Date(),
    };
  }
}
