import { z } from 'zod';

/** Leave guard settings (Dodatek 2, G2). */
export const leaveGuardSchema = z.object({
  mode: z.enum(['off', 'log', 'warn']).default('warn'),
  maxLeaves: z.number().int().min(0).max(10).default(2),
  onExceed: z.enum(['notify', 'lock']).default('notify'),
  requireFullscreen: z.boolean().default(false),
  minLeaveMs: z.number().int().min(500).max(5000).default(1000),
});
export type LeaveGuardSettings = z.output<typeof leaveGuardSchema>;
export const LEAVE_GUARD_DEFAULTS: LeaveGuardSettings = leaveGuardSchema.parse({});

export * from './leave-tracker.js';
