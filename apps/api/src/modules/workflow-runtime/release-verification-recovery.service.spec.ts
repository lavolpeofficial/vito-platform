import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AgentExecutionStatus,
  EngineeringCapability,
  EngineeringStepType,
} from '@vito/contracts';
import { ReleaseVerificationRecoveryService } from './release-verification-recovery.service';

const ORG='org-1';
const RUN='run-1';
const USER='user-1';
const VERIFY='verify-legacy-1';
const HUMAN='human-gate-1';
const PARSE='parse-1';
const EXEC='execution-1';
const RECOVERY='verify-recovery-1';
const APPROVAL='FREIGABE GOLDEN WORKFLOW STATE RECOVERY #160';

function buildService(overrides: {
  run?: any;
  humanStep?: any;
  verifyStep?: any;
  executionRecord?: any;
  nonterminalSteps?: any[];
  claimCount?: number;
  cancelCount?: number;
} = {}) {
  const run = overrides.run ?? {
    id: RUN,
    status: 'RUNNING',
    currentStepType: EngineeringStepType.HUMAN_RELEASE_GATE,
    correctionLoopCount: 3,
    maxCorrectionLoops: 3,
    correlationId: 'corr-1',
    blockReasonCode: null,
  };
  const humanStep = Object.prototype.hasOwnProperty.call(overrides,'humanStep')
    ? overrides.humanStep
    : { id:HUMAN, causationId:VERIFY, attemptNumber:1 };
  const verifyStep = Object.prototype.hasOwnProperty.call(overrides,'verifyStep')
    ? overrides.verifyStep
    : {
        id:VERIFY,
        causationId:PARSE,
        attemptNumber:1,
        metadata:{
          executionStatus:AgentExecutionStatus.SUCCEEDED,
          capabilityCode:EngineeringCapability.RELEASE_VERIFICATION,
          executionEvidence:{invocationId:EXEC},
        },
      };
  const executionRecord = Object.prototype.hasOwnProperty.call(overrides,'executionRecord')
    ? overrides.executionRecord
    : { id:EXEC };
  const nonterminalSteps = overrides.nonterminalSteps ?? [
    { id:HUMAN, stepType:EngineeringStepType.HUMAN_RELEASE_GATE, status:'READY' },
  ];

  const tx:any = {
    workflowRun:{
      findFirst:jest.fn().mockResolvedValue(run),
      updateMany:jest.fn().mockResolvedValue({count:overrides.claimCount ?? 1}),
    },
    workflowStepRun:{
      findFirst:jest.fn()
        .mockResolvedValueOnce(humanStep)
        .mockResolvedValueOnce(verifyStep),
      findMany:jest.fn().mockResolvedValue(nonterminalSteps),
      updateMany:jest.fn().mockResolvedValue({count:overrides.cancelCount ?? 1}),
      create:jest.fn().mockResolvedValue({id:RECOVERY}),
    },
    governedExecutionRecord:{
      findFirst:jest.fn().mockResolvedValue(executionRecord),
    },
  };
  const prisma:any = {$transaction:jest.fn((fn:(client:any)=>unknown)=>fn(tx))};
  const auditService:any = {record:jest.fn().mockResolvedValue(undefined)};
  return {service:new ReleaseVerificationRecoveryService(prisma,auditService),prisma,tx,auditService};
}

describe('ReleaseVerificationRecoveryService',()=>{
  it('creates one fresh READY VERIFY from the original upstream causation and triggers no execution',async()=>{
    const {service,tx,auditService}=buildService();

    const result=await service.recover({
      organizationId:ORG,
      workflowRunId:RUN,
      approvedByUserId:USER,
      isMachineIdentity:false,
      approvalRef:APPROVAL,
    });

    expect(tx.governedExecutionRecord.findFirst).toHaveBeenCalledWith({
      where:{
        id:EXEC,
        organizationId:ORG,
        workflowRunId:RUN,
        workflowStepRunId:VERIFY,
        capabilityCode:EngineeringCapability.RELEASE_VERIFICATION,
        status:AgentExecutionStatus.SUCCEEDED,
      },
      select:{id:true},
    });
    expect(tx.workflowRun.updateMany).toHaveBeenCalledWith({
      where:expect.objectContaining({
        id:RUN,
        organizationId:ORG,
        status:'RUNNING',
        currentStepType:EngineeringStepType.HUMAN_RELEASE_GATE,
        correctionLoopCount:3,
      }),
      data:{
        currentStepType:EngineeringStepType.VERIFY,
        blockReasonCode:null,
        failureReasonCode:null,
      },
    });
    expect(tx.workflowStepRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where:expect.objectContaining({
        id:HUMAN,
        stepType:EngineeringStepType.HUMAN_RELEASE_GATE,
        status:'READY',
      }),
      data:expect.objectContaining({status:'CANCELLED'}),
    }));
    expect(tx.workflowStepRun.create).toHaveBeenCalledWith({
      data:expect.objectContaining({
        organizationId:ORG,
        workflowRunId:RUN,
        stepType:EngineeringStepType.VERIFY,
        status:'READY',
        attemptNumber:2,
        causationId:PARSE,
        metadata:expect.objectContaining({
          source:'HUMAN_RELEASE_FALSE_POSITIVE_RECOVERY',
          approvalRef:APPROVAL,
          supersededVerifyStepRunId:VERIFY,
          supersededHumanReleaseGateStepRunId:HUMAN,
          governedExecutionRecordId:EXEC,
          preservedCorrectionLoopCount:3,
          executionLimit:1,
          executionTriggered:false,
          authorizedExecutionStep:EngineeringStepType.VERIFY,
        }),
      }),
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType:'USER',
        actorId:USER,
        action:'HUMAN_RELEASE_FALSE_POSITIVE_VERIFY_RECOVERY_REQUESTED',
      }),
      tx,
    );
    expect(result).toEqual(expect.objectContaining({
      disposition:'HUMAN_RELEASE_FALSE_POSITIVE_VERIFY_RECOVERY_CREATED',
      workflowStepRunId:RECOVERY,
      causationId:PARSE,
      supersededVerifyStepRunId:VERIFY,
      supersededHumanReleaseGateStepRunId:HUMAN,
      governedExecutionRecordId:EXEC,
      correctionLoopCount:3,
      maxCorrectionLoops:3,
      executionTriggered:false,
      authority:'HUMAN_EXPLICIT',
    }));
  });

  it('rejects machine identity and invalid approval before transaction',async()=>{
    let built=buildService();
    await expect(built.service.recover({
      organizationId:ORG,workflowRunId:RUN,approvedByUserId:USER,
      isMachineIdentity:true,approvalRef:APPROVAL,
    })).rejects.toThrow(ForbiddenException);
    expect(built.prisma.$transaction).not.toHaveBeenCalled();

    built=buildService();
    await expect(built.service.recover({
      organizationId:ORG,workflowRunId:RUN,approvedByUserId:USER,
      isMachineIdentity:false,approvalRef:'',
    })).rejects.toThrow(BadRequestException);
    expect(built.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed unless the run is exactly RUNNING at HUMAN_RELEASE_GATE',async()=>{
    const {service,tx}=buildService({
      run:{
        id:RUN,status:'RUNNING',currentStepType:EngineeringStepType.VERIFY,
        correctionLoopCount:3,maxCorrectionLoops:3,correlationId:'corr-1',blockReasonCode:null,
      },
    });
    await expect(service.recover({
      organizationId:ORG,workflowRunId:RUN,approvedByUserId:USER,
      isMachineIdentity:false,approvalRef:APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowStepRun.findFirst).not.toHaveBeenCalled();
  });

  it('refuses to reopen a VERIFY that already has a structured VALID PASS',async()=>{
    const {service,tx}=buildService({
      verifyStep:{
        id:VERIFY,causationId:PARSE,attemptNumber:1,
        metadata:{
          executionStatus:AgentExecutionStatus.SUCCEEDED,
          capabilityCode:EngineeringCapability.RELEASE_VERIFICATION,
          verificationResultProjectionStatus:'VALID',
          verificationResultStatus:'PASS',
          executionEvidence:{invocationId:EXEC},
        },
      },
    });

    await expect(service.recover({
      organizationId:ORG,workflowRunId:RUN,approvedByUserId:USER,
      isMachineIdentity:false,approvalRef:APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(tx.governedExecutionRecord.findFirst).not.toHaveBeenCalled();
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('requires an authoritative matching governed execution record',async()=>{
    const {service,tx}=buildService({executionRecord:null});
    await expect(service.recover({
      organizationId:ORG,workflowRunId:RUN,approvedByUserId:USER,
      isMachineIdentity:false,approvalRef:APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when another nonterminal step exists',async()=>{
    const {service,tx}=buildService({
      nonterminalSteps:[
        {id:HUMAN,stepType:EngineeringStepType.HUMAN_RELEASE_GATE,status:'READY'},
        {id:'unexpected',stepType:EngineeringStepType.REMOTE_VERIFY,status:'WAITING'},
      ],
    });
    await expect(service.recover({
      organizationId:ORG,workflowRunId:RUN,approvedByUserId:USER,
      isMachineIdentity:false,approvalRef:APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(tx.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed if the atomic run claim or human-gate cancellation is lost',async()=>{
    let built=buildService({claimCount:0});
    await expect(built.service.recover({
      organizationId:ORG,workflowRunId:RUN,approvedByUserId:USER,
      isMachineIdentity:false,approvalRef:APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(built.tx.workflowStepRun.create).not.toHaveBeenCalled();

    built=buildService({cancelCount:0});
    await expect(built.service.recover({
      organizationId:ORG,workflowRunId:RUN,approvedByUserId:USER,
      isMachineIdentity:false,approvalRef:APPROVAL,
    })).rejects.toThrow(ConflictException);
    expect(built.tx.workflowStepRun.create).not.toHaveBeenCalled();
  });
});
