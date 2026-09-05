import { Body, Controller, Post } from '@nestjs/common';
import { CommandBusService } from './command-bus.service';
import type { VitoCommand } from './command-bus.types';

@Controller('commands')
export class CommandBusController {
  constructor(private readonly commandBus: CommandBusService) {}

  @Post('dispatch')
  dispatch(@Body() command: VitoCommand) {
    return this.commandBus.dispatch(command);
  }
}
