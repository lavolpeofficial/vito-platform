import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type DepartmentRecord = Awaited<ReturnType<OrganizationChartService['loadDepartments']>>[number];
type PositionRecord = Awaited<ReturnType<OrganizationChartService['loadPositions']>>[number];

@Injectable()
export class OrganizationChartService {
  constructor(private readonly prisma: PrismaService) {}

  async getChart(organizationId: string, workforceInstanceId: string) {
    const workforce = await this.prisma.workforceInstance.findFirst({
      where: { id: workforceInstanceId, organizationId },
      include: { orchestrator: true },
    });

    if (!workforce) {
      throw new NotFoundException('Workforce nicht gefunden.');
    }

    const [departments, teams, positions] = await Promise.all([
      this.loadDepartments(organizationId, workforceInstanceId),
      this.prisma.team.findMany({
        where: { organizationId, workforceInstanceId },
        include: { manager: true },
        orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
      }),
      this.loadPositions(organizationId, workforceInstanceId),
    ]);

    const positionTree = this.buildPositionTree(positions);
    const departmentTree = this.buildDepartmentTree(departments, teams, positions);

    return {
      workforce: {
        id: workforce.id,
        code: workforce.code,
        name: workforce.name,
        status: workforce.status,
        isDefault: workforce.isDefault,
        orchestrator: workforce.orchestrator,
      },
      summary: {
        departments: departments.length,
        teams: teams.length,
        positions: positions.length,
        occupiedPositions: positions.filter((position) => position.occupantEmployeeId).length,
        vacantPositions: positions.filter((position) => !position.occupantEmployeeId).length,
        leadershipPositions: positions.filter((position) => position.isLeadership).length,
      },
      departmentTree,
      reportingTree: positionTree,
      unassignedPositions: positions
        .filter((position) => !position.departmentId)
        .map((position) => this.toPositionNode(position)),
    };
  }

  async loadDepartments(organizationId: string, workforceInstanceId: string) {
    return this.prisma.department.findMany({
      where: { organizationId, workforceInstanceId },
      include: { manager: true },
      orderBy: [{ parentDepartmentId: 'asc' }, { name: 'asc' }],
    });
  }

  async loadPositions(organizationId: string, workforceInstanceId: string) {
    return this.prisma.position.findMany({
      where: { organizationId, workforceInstanceId },
      include: {
        occupant: true,
        organizationRole: true,
        department: true,
        team: true,
      },
      orderBy: [{ managerPositionId: 'asc' }, { title: 'asc' }],
    });
  }

  private buildDepartmentTree(
    departments: DepartmentRecord[],
    teams: Array<{
      id: string;
      departmentId: string;
      code: string;
      name: string;
      description: string | null;
      status: string;
      manager: unknown;
    }>,
    positions: PositionRecord[],
  ) {
    const byParent = new Map<string | null, DepartmentRecord[]>();

    for (const department of departments) {
      const key = department.parentDepartmentId ?? null;
      const siblings = byParent.get(key) ?? [];
      siblings.push(department);
      byParent.set(key, siblings);
    }

    const buildNode = (department: DepartmentRecord): Record<string, unknown> => ({
      id: department.id,
      code: department.code,
      name: department.name,
      description: department.description,
      status: department.status,
      manager: department.manager,
      positions: positions
        .filter((position) => position.departmentId === department.id && !position.teamId)
        .map((position) => this.toPositionNode(position)),
      teams: teams
        .filter((team) => team.departmentId === department.id)
        .map((team) => ({
          ...team,
          positions: positions
            .filter((position) => position.teamId === team.id)
            .map((position) => this.toPositionNode(position)),
        })),
      children: (byParent.get(department.id) ?? []).map(buildNode),
    });

    return (byParent.get(null) ?? []).map(buildNode);
  }

  private buildPositionTree(positions: PositionRecord[]) {
    const byManager = new Map<string | null, PositionRecord[]>();

    for (const position of positions) {
      const key = position.managerPositionId ?? null;
      const reports = byManager.get(key) ?? [];
      reports.push(position);
      byManager.set(key, reports);
    }

    const buildNode = (position: PositionRecord): Record<string, unknown> => ({
      ...this.toPositionNode(position),
      directReports: (byManager.get(position.id) ?? []).map(buildNode),
    });

    return (byManager.get(null) ?? []).map(buildNode);
  }

  private toPositionNode(position: PositionRecord) {
    return {
      id: position.id,
      code: position.code,
      title: position.title,
      description: position.description,
      status: position.status,
      isLeadership: position.isLeadership,
      budgetResponsibility: position.budgetResponsibility,
      managerPositionId: position.managerPositionId,
      role: position.organizationRole,
      occupant: position.occupant,
      department: position.department
        ? { id: position.department.id, code: position.department.code, name: position.department.name }
        : null,
      team: position.team ? { id: position.team.id, code: position.team.code, name: position.team.name } : null,
    };
  }
}
