import { z } from 'zod';

export const scoresSchema = z.object({
  hook: z.number().min(0).max(100), value: z.number().min(0).max(100), originality: z.number().min(0).max(100),
  readability: z.number().min(0).max(100), brandFit: z.number().min(0).max(100), leadPotential: z.number().min(0).max(100),
  authenticity: z.number().min(0).max(100), overall: z.number().min(0).max(100),
}).strict();
export const blockSchema = z.object({ id: z.string().min(1).max(40), kind: z.enum(['hook', 'body', 'cta']), text: z.string().min(1).max(3000) }).strict();
export const draftSchema = z.object({
  blocks: z.array(blockSchema).min(2).max(15), topic: z.string().min(1).max(300), category: z.string().min(1).max(150),
  audience: z.string().min(1).max(150), format: z.string().min(1).max(60), pillar: z.enum(['education', 'opinion', 'building', 'commercial']),
  series: z.string().max(150).nullable(), sourceIds: z.array(z.string().max(100)).max(30), scores: scoresSchema,
}).strict();
export const critiqueSchema = z.object({
  pass: z.boolean(), scores: scoresSchema, issues: z.array(z.string().max(500)).max(20),
  unsupportedClaims: z.array(z.string().max(500)).max(20),
}).strict();
export const editsSchema = z.object({
  edits: z.array(z.object({ blockId: z.string().max(40), text: z.string().max(3000).nullable() }).strict()).min(1).max(15),
}).strict();
export const ideasSchema = z.object({ ideas: z.array(z.object({
  title: z.string().min(5).max(250), category: z.string().min(2).max(150), audience: z.string().min(2).max(150), angle: z.string().min(5).max(600),
  hookIdea: z.string().min(5).max(300), pillar: z.enum(['education', 'opinion', 'building', 'commercial']), format: z.string().min(2).max(60),
  series: z.string().max(150).nullable(), priority: z.number().min(0).max(100), freshness: z.number().min(0).max(100),
}).strict()).max(50) }).strict();
