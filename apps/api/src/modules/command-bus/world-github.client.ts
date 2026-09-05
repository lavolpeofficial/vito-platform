import { Injectable } from '@nestjs/common';
import { ServerCredentialResolver } from '../server-credentials/server-credential.resolver';

interface GitHubContentsResponse {
  content?: string;
  encoding?: string;
}

interface WorkflowRun {
  id: number;
  name: string;
  path: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_branch: string;
  head_sha: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

interface WorkflowRunsResponse {
  workflow_runs?: WorkflowRun[];
}

interface WorkflowArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  archive_download_url: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface WorkflowArtifactsResponse {
  artifacts?: WorkflowArtifact[];
}

export interface WorldGateManifest {
  gate: string;
  caseId: string;
  verifier: string;
  triggeredAt: string;
}

export type WorldWorkflowRun = WorkflowRun;
export type WorldWorkflowArtifact = WorkflowArtifact;

@Injectable()
export class WorldGitHubClient {
  readonly repository = process.env.WORLD_REPOSITORY ?? 'lavolpeofficial/aoe-knowledge-engine';
  readonly branch = process.env.WORLD_BRANCH ?? 'case/global-resilience-harvest-v0.1-agent';
  readonly workflow = process.env.WORLD_GATE_WORKFLOW ?? 'world-remote-gate.yml';
  readonly credentialRef = process.env.WORLD_GITHUB_CREDENTIAL_REF ?? 'github.world.actions';

  constructor(private readonly credentials: ServerCredentialResolver) {}

  async getManifest(): Promise<WorldGateManifest> {
    const url = `https://api.github.com/repos/${this.repository}/contents/ci/world-remote-gate.json?ref=${encodeURIComponent(this.branch)}`;
    const response = await this.request(url);
    const payload = (await response.json()) as GitHubContentsResponse;
    if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
      throw new Error('WORLD_MANIFEST_CONTENT_INVALID');
    }
    const decoded = Buffer.from(payload.content.replace(/\n/g, ''), 'base64').toString('utf8');
    const manifest = JSON.parse(decoded) as Partial<WorldGateManifest>;
    for (const key of ['gate', 'caseId', 'verifier', 'triggeredAt'] as const) {
      if (typeof manifest[key] !== 'string' || manifest[key] === '') {
        throw new Error(`WORLD_MANIFEST_INVALID_${key}`);
      }
    }
    return manifest as WorldGateManifest;
  }

  async getBranchHeadSha(): Promise<string> {
    const url = `https://api.github.com/repos/${this.repository}/commits/${encodeURIComponent(this.branch)}`;
    const response = await this.request(url);
    const payload = (await response.json()) as { sha?: unknown };
    if (typeof payload.sha !== 'string' || payload.sha === '') throw new Error('WORLD_BRANCH_HEAD_INVALID');
    return payload.sha;
  }

  async dispatchWorkflow(): Promise<void> {
    const url = `https://api.github.com/repos/${this.repository}/actions/workflows/${encodeURIComponent(this.workflow)}/dispatches`;
    await this.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: this.branch }),
    });
  }

  async listWorkflowRuns(): Promise<WorldWorkflowRun[]> {
    const url = `https://api.github.com/repos/${this.repository}/actions/runs?branch=${encodeURIComponent(this.branch)}&event=workflow_dispatch&per_page=20`;
    const response = await this.request(url);
    const payload = (await response.json()) as WorkflowRunsResponse;
    return Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
  }

  async getWorkflowRun(runId: number): Promise<WorldWorkflowRun> {
    const url = `https://api.github.com/repos/${this.repository}/actions/runs/${runId}`;
    const response = await this.request(url);
    return (await response.json()) as WorldWorkflowRun;
  }

  async getWorkflowArtifacts(runId: number): Promise<WorldWorkflowArtifact[]> {
    const url = `https://api.github.com/repos/${this.repository}/actions/runs/${runId}/artifacts`;
    const response = await this.request(url);
    const payload = (await response.json()) as WorkflowArtifactsResponse;
    return Array.isArray(payload.artifacts) ? payload.artifacts : [];
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = this.credentials.resolve(this.credentialRef);
    if (!token) throw new Error('WORLD_GITHUB_CREDENTIAL_MISSING');

    const headers = new Headers(init.headers);
    headers.set('accept', 'application/vnd.github+json');
    headers.set('authorization', `Bearer ${token}`);
    headers.set('x-github-api-version', '2022-11-28');

    const response = await fetch(url, { ...init, headers });
    if (!response.ok) throw new Error(`WORLD_GITHUB_HTTP_${response.status}`);
    return response;
  }
}
