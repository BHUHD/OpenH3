import type { H3ComfyDiagnosis } from '@/common/chat/document/h3Job';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Keep actionable identifiers, never copy backend tracebacks or user inputs into public errors. */
export class H3ComfyError extends Error {
  constructor(prefix: string, readonly diagnosis: H3ComfyDiagnosis) {
    super(`${prefix}:${diagnosis.category}${diagnosis.nodeId ? `:node=${diagnosis.nodeId}` : ''}`);
    this.name = 'H3ComfyError';
  }
}

export function diagnoseComfyError(payload: unknown, submission = false): H3ComfyError {
  const body = record(payload);
  const messages = record(body.status).messages;
  const event = Array.isArray(messages) ? messages.findLast((item) => Array.isArray(item) && item[0] === 'execution_error') : undefined;
  const detail = record(Array.isArray(event) ? event[1] : body.error);
  const nodeErrors = record(body.node_errors);
  const nodeIdRaw = detail.node_id ?? Object.keys(nodeErrors)[0];
  const nodeId = typeof nodeIdRaw === 'string' && /^[\w:.-]{1,100}$/.test(nodeIdRaw) ? nodeIdRaw : undefined;
  const nodeDetail = record(nodeId ? nodeErrors[nodeId] : undefined);
  const errors = Array.isArray(nodeDetail.errors) ? nodeDetail.errors.map(record) : [];
  const types = [detail.exception_type, detail.type, ...errors.map((error) => error.type)].filter((v) => typeof v === 'string').join(' ');
  let category: H3ComfyDiagnosis['category'] = submission ? 'INVALID_INPUT' : 'EXECUTION_FAILED';
  if (/OutOfMemoryError/i.test(types)) category = 'OOM';
  else if (/FileNotFoundError|model_not_found/i.test(types)) category = 'MISSING_MODEL';
  else if (/invalid_prompt|node_not_found|missing_node/i.test(types)) category = 'MISSING_NODE';
  const actions = {
    OOM: 'REVIEW_MEMORY_BUDGET', MISSING_MODEL: 'CHECK_MODEL_MANIFEST', MISSING_NODE: 'CHECK_NODE_MANIFEST',
    INVALID_INPUT: 'CHECK_WORKFLOW_INPUTS', EXECUTION_FAILED: 'INSPECT_RUNTIME_LOG',
  };
  return new H3ComfyError(submission ? 'H3_COMFY_PROMPT_REJECTED' : 'H3_COMFY_EXECUTION_FAILED', {
    category, nodeId, retryable: false, action: actions[category],
  });
}
