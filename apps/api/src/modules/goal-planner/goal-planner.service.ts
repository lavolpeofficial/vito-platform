import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { EngineeringStepType } from '@vito/contracts';
import { WorkflowExecutionPlanService } from '../agent-workforce/workflow-execution-plan.service';
import { MemoryService, type MemoryEntry } from '../memory/memory.service';
import { KnowledgeHarvesterService } from '../source-vault/knowledge-harvester.service';

const PRIMARY_ENGINEERING_PATH: readonly EngineeringStepType[] = Object.freeze([
  EngineeringStepType.PLAN,
  EngineeringStepType.BUILD,
  EngineeringStepType.TEST,
  EngineeringStepType.PACKAGE,
  EngineeringStepType.RED_TEAM,
  EngineeringStepType.PARSE_VERDICT,
  EngineeringStepType.VERIFY,
  EngineeringStepType.HUMAN_RELEASE_GATE,
  EngineeringStepType.RELEASE_EXECUTION,
  EngineeringStepType.REMOTE_VERIFY,
]);
const MAX_MEMORY_EVIDENCE_ITEMS = 5;
const MAX_MEMORY_EVIDENCE_CONTENT_CHARS = 2_000;

@Injectable()
export class GoalPlannerService {
  constructor(
    private readonly executionPlan: WorkflowExecutionPlanService,
    private readonly knowledge: KnowledgeHarvesterService,
    @Optional() private readonly memory?: MemoryService,
  ) {}

  async planEngineeringGoal(
    organizationId: string,
    goal: string,
    assuranceLevel: 'AL1' | 'AL2' | 'AL3' | 'AL4' = 'AL3',
  ) {
    const normalizedGoal = goal.trim();
    if (normalizedGoal.length < 10 || normalizedGoal.length > 2000) {
      throw new BadRequestException('Goal must contain between 10 and 2000 characters.');
    }

    const knowledgeEvidence = await this.knowledge.search(organizationId, normalizedGoal, 5).catch(() => []);
    const memoryEvidence = await this.retrievePlanningMemory(organizationId, normalizedGoal);
    const steps = PRIMARY_ENGINEERING_PATH.map((stepType, index) => {
      const capabilityCode = this.executionPlan.capabilityForStep(stepType);
      return Object.freeze({
        order: index + 1,
        stepType,
        capabilityCode,
        executionAuthority: capabilityCode ? 'AGENT_WORKFORCE' as const : 'WORKFLOW_GOVERNANCE' as const,
        humanBoundary: stepType === EngineeringStepType.HUMAN_RELEASE_GATE,
        conditional: false,
      });
    });

    const correctionLoop = Object.freeze({
      stepType: EngineeringStepType.CORRECTION,
      capabilityCode: this.executionPlan.capabilityForStep(EngineeringStepType.CORRECTION),
      executionAuthority: 'AGENT_WORKFORCE' as const,
      trigger: 'TEST_FAILURE_OR_REVIEW_VERDICT_C',
      returnsTo: EngineeringStepType.TEST,
      maxLoops: 3,
    });

    return Object.freeze({
      plannerVersion: '1',
      planningMode: 'TEMPLATE_GROUNDED' as const,
      goalClass: 'ENGINEERING_CHANGE' as const,
      goal: normalizedGoal,
      assuranceLevel,
      providerSelection: 'DEFERRED_TO_PROVIDER_ROUTER' as const,
      requiresHumanReleaseApproval: true,
      steps: Object.freeze(steps),
      correctionLoop,
      knowledgeEvidence: Object.freeze(knowledgeEvidence.map((item) => Object.freeze({
        knowledgeUnitId: item.id,
        sourceId: item.sourcePublicId,
        locatorType: item.locatorType,
        locatorValue: item.locatorValue,
        content: item.content,
        rank: item.rank,
      }))),
      memoryEvidence,
      executable: false,
      nextAction: 'CREATE_GOVERNED_WORKFLOW_FROM_APPROVED_PLAN' as const,
    });
  }

  private async retrievePlanningMemory(
    organizationId: string,
    goal: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    if (!this.memory) return [];
    try {
      const entries = await this.memory.search(
        organizationId,
        goal.slice(0, 512),
        MAX_MEMORY_EVIDENCE_ITEMS,
        [{ scope: 'GLOBAL' }, { scope: 'ORGANIZATION' }],
      );
      return Object.freeze(entries.slice(0, MAX_MEMORY_EVIDENCE_ITEMS).map((entry) => this.toPlanningEvidence(entry)));
    } catch {
      return [];
    }
  }

  private toPlanningEvidence(entry: MemoryEntry): Readonly<Record<string, unknown>> {
    return Object.freeze({
      memoryEntryId: entry.id,
      kind: entry.kind,
      scope: entry.scope,
      title: entry.title.slice(0, 256),
      content: entry.content.slice(0, MAX_MEMORY_EVIDENCE_CONTENT_CHARS),
      sourceType: entry.sourceType.slice(0, 256),
      sourceRef: entry.sourceRef?.slice(0, 256) ?? null,
      confidence: entry.confidence,
    });
  }
}
