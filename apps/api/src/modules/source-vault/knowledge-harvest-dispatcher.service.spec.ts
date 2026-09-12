import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SourceType } from '@prisma/client';
import {
  KnowledgeHarvestDispatcherService,
  resolveKnowledgeHarvester,
} from './knowledge-harvest-dispatcher.service';

describe('resolveKnowledgeHarvester', () => {
  it('routes governed DOCX, XLSX and text formats deterministically', () => {
    expect(resolveKnowledgeHarvester({
      sourceType: SourceType.DOCUMENT,
      originalFilename: 'policy.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })).toBe('DOCX');

    expect(resolveKnowledgeHarvester({
      sourceType: SourceType.SPREADSHEET,
      originalFilename: 'metrics.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })).toBe('XLSX');

    expect(resolveKnowledgeHarvester({
      sourceType: SourceType.DOCUMENT,
      originalFilename: 'notes.txt',
      mimeType: 'text/plain; charset=utf-8',
    })).toBe('TEXT');
  });

  it('fails closed for unsupported source formats instead of guessing', () => {
    expect(() => resolveKnowledgeHarvester({
      sourceType: SourceType.DOCUMENT,
      originalFilename: 'scan.pdf',
      mimeType: 'application/pdf',
    })).toThrow(BadRequestException);
  });
});

describe('KnowledgeHarvestDispatcherService', () => {
  it('uses tenant-scoped source metadata and delegates to the selected harvester', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      sourceType: SourceType.SPREADSHEET,
      originalFilename: 'metrics.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const harvester = {
      harvestTextSource: jest.fn(),
      harvestDocxSource: jest.fn(),
      harvestXlsxSource: jest.fn().mockResolvedValue({ sourceFormat: 'XLSX' }),
    };
    const service = new KnowledgeHarvestDispatcherService(
      { source: { findFirst } } as any,
      harvester as any,
    );

    await expect(service.harvestSource('org-1', 'source-1')).resolves.toEqual({ sourceFormat: 'XLSX' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'source-1', organizationId: 'org-1' },
      select: { sourceType: true, originalFilename: true, mimeType: true },
    });
    expect(harvester.harvestXlsxSource).toHaveBeenCalledWith('org-1', 'source-1');
    expect(harvester.harvestDocxSource).not.toHaveBeenCalled();
    expect(harvester.harvestTextSource).not.toHaveBeenCalled();
  });

  it('does not dispatch a source outside the tenant boundary', async () => {
    const service = new KnowledgeHarvestDispatcherService(
      { source: { findFirst: jest.fn().mockResolvedValue(null) } } as any,
      {} as any,
    );
    await expect(service.harvestSource('org-1', 'source-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
