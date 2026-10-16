/** Read JSON tool payloads from both native and ACP tool transports. */
export function toolResultRecords(message: { type: string; content: unknown }): Record<string, unknown>[] {
  if (!['tool_call', 'acp_tool_call', 'tool_group'].includes(message.type)) return [];
  const records: Record<string, unknown>[] = [];
  let remaining = 1000;
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 10 || --remaining < 0) return;
    if (typeof value === 'string') {
      if (value.length > 1_000_000) return;
      try {
        visit(JSON.parse(value), depth + 1);
      } catch {
        /* Incomplete and plain-text outputs have no payload. */
      }
    } else if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      records.push(record);
      for (const [key, child] of Object.entries(record))
        if (!['args', 'input', 'raw_input', 'rawInput'].includes(key)) visit(child, depth + 1);
    }
  };
  visit(message.content);
  return records;
}

export function creationOperationIds(messages: Array<{ type: string; content: unknown }>): string[] {
  return [
    ...new Set(
      messages
        .flatMap(toolResultRecords)
        .map((record) => record.creationOperationId)
        .filter(
          (id): id is string =>
            typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
        )
    ),
  ];
}
