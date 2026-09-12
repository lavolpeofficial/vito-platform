import { BadRequestException } from '@nestjs/common';
import { ExperienceStoreService } from './experience-store.service';
import {
  LearningObservabilityController,
  parseLimit,
  parseStatuses,
} from './learning-observability.controller';
import { OutcomeEvaluationService } from './outcome-evaluation.service';
import { ReflectionService } from './reflection.service';

describe('LearningObservabilityController', () => {
  it('delegates bounded tenant-scoped experience search to the authoritative store', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const controller = new LearningObservabilityController(
      { search } as unknown as ExperienceStoreService,
      {} as OutcomeEvaluationService,
      {} as ReflectionService,
    );

    await controller.listExperiences(' agent-1 ', ['OBSERVED', 'REFLECTED'], '25');

    expect(search).toHaveBeenCalledWith({
      agentId: 'agent-1',
      statuses: ['OBSERVED', 'REFLECTED'],
      limit: 25,
    });
  });

  it('delegates detail surfaces without introducing mutation semantics', async () => {
    const get = jest.fn().mockResolvedValue({ id: 'exp-1' });
    const listForExperienceOutcomes = jest.fn().mockResolvedValue([]);
    const listForExperienceReflections = jest.fn().mockResolvedValue([]);
    const controller = new LearningObservabilityController(
      { get } as unknown as ExperienceStoreService,
      { listForExperience: listForExperienceOutcomes } as unknown as OutcomeEvaluationService,
      { listForExperience: listForExperienceReflections } as unknown as ReflectionService,
    );

    await controller.getExperience(' exp-1 ');
    await controller.listOutcomes(' exp-1 ');
    await controller.listReflections(' exp-1 ');

    expect(get).toHaveBeenCalledWith('exp-1');
    expect(listForExperienceOutcomes).toHaveBeenCalledWith('exp-1');
    expect(listForExperienceReflections).toHaveBeenCalledWith('exp-1');
  });
});

describe('learning observability query boundaries', () => {
  it('accepts only persisted experience statuses and de-duplicates filters', () => {
    expect(parseStatuses('OBSERVED,REFLECTED,OBSERVED')).toEqual(['OBSERVED', 'REFLECTED']);
    expect(() => parseStatuses('EXECUTABLE')).toThrow(BadRequestException);
    expect(() => parseStatuses(' , ')).toThrow(BadRequestException);
  });

  it('enforces the repository limit boundary before querying', () => {
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('100')).toBe(100);
    expect(() => parseLimit('0')).toThrow(BadRequestException);
    expect(() => parseLimit('101')).toThrow(BadRequestException);
    expect(() => parseLimit('1.5')).toThrow(BadRequestException);
  });
});
