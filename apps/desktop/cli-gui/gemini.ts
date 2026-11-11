import { randomUUID } from 'node:crypto';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Normalize Gemini's tool transcript to Messages before entering the existing GUI proxy. */
export function geminiMessages(input: Json): Json {
  const calls = new Map<string, string[]>();
  const messages = array(input.contents).map(value => {
    const content = object(value);
    const blocks = array(content.parts).flatMap(part => geminiPart(object(part), calls));
    return { role: content.role === 'model' ? 'assistant' : 'user', content: blocks };
  });
  const config = object(input.generationConfig);
  const schema = config.responseJsonSchema ?? config.responseSchema;
  const calling = object(object(input.toolConfig).functionCallingConfig);
  return {
    messages, system: array(object(input.systemInstruction).parts)
      .map(part => object(part).text).filter(text => typeof text === 'string').join('\n'),
    tools: array(input.tools).flatMap(tool => array(object(tool).functionDeclarations).map(value => {
      const declaration = object(value);
      return { name: declaration.name, description: declaration.description,
        input_schema: normalizeSchema(declaration.parametersJsonSchema ?? declaration.parameters
          ?? { type: 'object', properties: {} }) };
    })),
    max_tokens: config.maxOutputTokens ?? 16_384, stream: true,
    metadata: { ...(schema ? { remoteai_output_schema: normalizeSchema(schema) } : {}),
      ...(config.responseMimeType === 'application/json' ? { remoteai_json_output: true } : {}) },
    ...(calling.mode === 'NONE' ? { tool_choice: { type: 'none' } }
      : calling.mode === 'ANY' ? { tool_choice: { type: 'any' } } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
  };
}

function normalizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, key === 'type' && typeof entry === 'string' ? entry.toLowerCase() : normalizeSchema(entry)]));
}

function geminiPart(part: Json, calls: Map<string, string[]>): Json[] {
  if (typeof part.text === 'string') return [{ type: 'text', text: part.text }];
  if (part.functionCall) {
    const call = object(part.functionCall);
    const name = String(call.name);
    const id = typeof call.id === 'string' ? call.id : `call_${randomUUID()}`;
    calls.set(name, [...(calls.get(name) ?? []), id]);
    return [{ type: 'tool_use', id, name, input: call.args ?? {} }];
  }
  if (part.functionResponse) {
    const response = object(part.functionResponse);
    const queuedId = calls.get(String(response.name))?.shift();
    return [{ type: 'tool_result', tool_use_id: response.id ?? queuedId ?? String(response.name),
      content: JSON.stringify(response.response ?? {}) }];
  }
  if (part.inlineData) {
    const data = object(part.inlineData);
    if (typeof data.mimeType === 'string' && data.mimeType.startsWith('image/')) {
      return [{ type: 'image', source: { type: 'base64', media_type: data.mimeType, data: data.data } }];
    }
  }
  throw new Error('client.cliGui.unsupportedContent');
}

export class GeminiStream {
  private tools = new Map<number, { id: unknown; name: unknown; json: string; input: unknown }>();
  private inputTokens = 0;
  private outputTokens = 0;
  convert(event: Json): Json | undefined {
    const index = Number(event.index);
    const block = object(event.content_block);
    const delta = object(event.delta);
    if (event.type === 'message_start') this.inputTokens = Number(object(object(event.message).usage).input_tokens ?? 0);
    if (event.type === 'content_block_start' && block.type === 'tool_use') {
      this.tools.set(index, { id: block.id, name: block.name, json: '', input: block.input });
    }
    if (event.type === 'content_block_start' && block.type === 'text' && block.text) {
      return this.chunk([{ text: block.text }]);
    }
    if (event.type === 'content_block_delta') {
      if (delta.type === 'text_delta') return this.chunk([{ text: delta.text }]);
      if (delta.type === 'thinking_delta') return this.chunk([{ text: delta.thinking, thought: true }]);
      const tool = this.tools.get(index);
      if (tool && typeof delta.partial_json === 'string') tool.json += delta.partial_json;
    }
    if (event.type === 'content_block_stop' && this.tools.has(index)) {
      const tool = this.tools.get(index)!;
      this.tools.delete(index);
      return this.chunk([{ functionCall: { id: tool.id, name: tool.name,
        args: tool.json ? JSON.parse(tool.json) : tool.input ?? {} } }]);
    }
    if (event.type === 'message_delta') {
      this.outputTokens = Number(object(event.usage).output_tokens ?? this.outputTokens);
      return { ...this.chunk([]), candidates: [{ content: { role: 'model', parts: [] }, index: 0,
        finishReason: delta.stop_reason === 'max_tokens' ? 'MAX_TOKENS' : 'STOP' }],
      usageMetadata: { promptTokenCount: this.inputTokens, candidatesTokenCount: this.outputTokens,
        totalTokenCount: this.inputTokens + this.outputTokens } };
    }
    if (event.type === 'error') throw new Error('client.cliGui.requestFailed');
    return undefined;
  }
  private chunk(parts: Json[]): Json { return { candidates: [{ content: { role: 'model', parts }, index: 0 }] }; }
}

export async function* geminiChunks(body: ReadableStream<Uint8Array>) {
  const stream = new GeminiStream();
  let pending = '';
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += value;
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, boundary).trim(); pending = pending.slice(boundary + 1);
        if (!line.startsWith('data:')) continue;
        const chunk = stream.convert(JSON.parse(line.slice(5)) as Json);
        if (chunk) yield chunk;
      }
    }
  } finally { await reader.cancel(); }
}
