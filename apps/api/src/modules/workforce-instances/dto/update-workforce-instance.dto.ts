import { PartialType } from '@nestjs/swagger';
import { CreateWorkforceInstanceDto } from './create-workforce-instance.dto';

export class UpdateWorkforceInstanceDto extends PartialType(CreateWorkforceInstanceDto) {}
