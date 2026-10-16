import type { H3GenerationSpec } from '../h3Job';

export type CreationInstallConsent = {
  download: boolean;
  acceptModelTerms: boolean;
  acceptExperimentalHardware?: boolean;
};
export type CreationOperation = {
  id: string;
  requestId: string;
  conversationId?: string;
  state:
    | 'awaiting-consent'
    | 'authorized'
    | 'installing'
    | 'paused'
    | 'failed'
    | 'submitted'
    | 'cancelling'
    | 'cancelled';
  spec: H3GenerationSpec;
  consent?: CreationInstallConsent;
  jobId?: string;
  error?: string;
  updatedAt: string;
};
