import type { PostStatus } from './types.js';

const transitions: Record<PostStatus, readonly PostStatus[]> = {
  idea: ['draft', 'waiting_approval', 'cancelled'],
  draft: ['waiting_approval', 'cancelled'],
  waiting_approval: ['revision_requested', 'waiting_approval', 'approved', 'cancelled', 'postponed'],
  revision_requested: ['draft', 'waiting_approval', 'cancelled'],
  approved: ['publishing', 'cancelled', 'postponed'],
  publishing: ['published', 'failed', 'publish_uncertain', 'approved'],
  published: [], failed: ['approved', 'cancelled', 'postponed'],
  cancelled: [], postponed: ['waiting_approval', 'cancelled', 'postponed'], publish_uncertain: ['published'], // Only explicit administrative reconciliation may take this edge.
};
export class ConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'ConflictError'; }
}
export function canTransition(from: PostStatus, to: PostStatus): boolean { return transitions[from].includes(to); }
export function assertTransition(from: PostStatus, to: PostStatus): void {
  if (!canTransition(from, to)) throw new ConflictError(`Geçersiz durum geçişi: ${from} → ${to}`);
}
