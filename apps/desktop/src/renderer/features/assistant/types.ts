import type {
  AssistantSourceSchema,
  Command,
  CommandStepSchema
} from '../../../shared/contracts';
import type { z } from 'zod';

export type AssistantSource = z.infer<typeof AssistantSourceSchema>;
export type CommandStep = z.infer<typeof CommandStepSchema>;
export type { Command };
