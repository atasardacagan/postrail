export type PostStatus = 'idea' | 'draft' | 'waiting_approval' | 'revision_requested' | 'approved' | 'publishing' | 'published' | 'failed' | 'cancelled' | 'postponed' | 'publish_uncertain';
export type ContentPillar = 'education' | 'opinion' | 'building' | 'commercial';
export interface Idea {
  id: string; userId: string; title: string; category: string; audience: string; angle: string;
  hookIdea: string; pillar: ContentPillar; format: string; series: string | null;
  priority: number; freshness: number; used: boolean; createdAt: string;
}
export interface ContentBlock { id: string; kind: 'hook' | 'body' | 'cta'; text: string }
export interface SourceFact { id: string; url: string | null; text: string; verified: boolean; personal: boolean }
export interface Scores { hook: number; value: number; originality: number; readability: number; brandFit: number; leadPotential: number; authenticity: number; overall: number }
export interface DraftContent {
  blocks: ContentBlock[]; topic: string; category: string; audience: string; format: string;
  pillar: ContentPillar; series: string | null; sourceIds: string[]; scores: Scores;
}
export interface Post {
  id: string; userId: string; ideaId: string | null; status: PostStatus; scheduledAt: string;
  currentVersion: number; approvedVersion: number | null; createdAt: string; updatedAt: string;
  failure: string | null;
}
export interface Version { id: string; postId: string; userId: string; version: number; content: DraftContent; text: string; fingerprint: string; instruction: string | null; createdAt: string }
export interface Settings {
  postingDays: number[]; postingTimes: string[]; timezone: string; contentLanguage: string;
  contentCategories: string[]; minPostLength: number; maxPostLength: number;
  hashtagMode: 'none' | 'minimal'; ctaFrequency: number; commercialContentRatio: number;
  telegramUserId: string; qualityThreshold: number; similarityThreshold: number;
  explorationRatio: number; backlogTarget: number; weeklyReportDay: number; weeklyReportTime: string;
  memoryEnabled: boolean;
}
export interface BrandMemory { id: string; preference: string; count: number; enabled: boolean }
export interface PerformancePattern { dimension: string; value: string; score: number; sampleSize: number }
export interface ContentContext { settings: Settings; history: Version[]; memory: BrandMemory[]; facts: SourceFact[]; patterns: PerformancePattern[] }
export interface EditResult { content: DraftContent; preference: string | null }
export interface ContentEngine {
  ideas(context: ContentContext, existing: Idea[], count: number): Promise<Omit<Idea, 'id' | 'userId' | 'used' | 'createdAt'>[]>;
  generate(idea: Idea, context: ContentContext): Promise<DraftContent>;
  revise(current: DraftContent, instruction: string, context: ContentContext, conversation: string[]): Promise<EditResult>;
  rewrite(current: DraftContent, context: ContentContext): Promise<DraftContent>;
}
export interface TelegramButton { text: string; callback_data: string }
export interface TelegramPort {
  send(chatId: string, text: string, buttons?: TelegramButton[][]): Promise<{ messageId: number }>;
  answerCallback(id: string, text?: string): Promise<void>;
}
export interface PublishResult { urn: string; url: string }
export interface LinkedInPort { publish(text: string, idempotencyKey: string): Promise<PublishResult> }
export interface MetricInput {
  impressions?: number | null; reactions?: number | null; comments?: number | null;
  reposts?: number | null; followerChange?: number | null; profileViews?: number | null;
  inboundLeads?: number | null; observedAt: string; source: 'manual' | 'api';
}
export interface Logger { info(obj: object, message?: string): void; warn(obj: object, message?: string): void; error(obj: object, message?: string): void }
