import { BadRequestException, Injectable } from '@nestjs/common';
import { EngineeringStepType } from '@vito/contracts';
import { WorkflowExecutionPlanService } from '../agent-workforce/workflow-execution-plan.service';
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

@Injectable()
export class GoalPlannerService {
  constructor(
    private readonly executionPlan: WorkflowExecutionPlanService,
    private readonly knowledge: KnowledgeHarvesterService,
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
      executable: false,
      nextAction: 'CREATE_GOVERNED_WORKFLOW_FROM_APPROVED_PLAN' as const,
    });
  }
}
