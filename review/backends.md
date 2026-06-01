> Historical adversarial-review artifact. This is not the current vulnerability list; see `review/README.md` and `PROGRESS.md` for current status.

Now I have all the evidence. Let me compile the final report.

---

## Adversarial Review — Backends Dimension

### Finding 1 — `_runWithTools` drops tool_results for regular tools when StructuredOutput validation fails in same response

**Severity: HIGH** | `src/backend.ts:314-322`

When the model returns both a `StructuredOutput` tool_use (invalid) **and** regular tool_use blocks in the same response, the code enters the StructuredOutput validation-failure branch (line 314) and pushes only a validation-error text as the next user message — **no `tool_result` for the regular tools**. The Anthropic Messages API requires a `tool_result` for every `tool_use` in the preceding assistant message; the next call would return a 400.

**confirmed by:**
```bash
node -e "
const { AnthropicBackend } = require('./dist/backend.js');
let apiCalls = [];
const fakeClient = { messages: { create: async (params) => {
  apiCalls.push(JSON.parse(JSON.stringify(params)));
  if (apiCalls.length === 1) return {
    content: [
      { type: 'tool_use', id: 'tu_lookup', name: 'lookup', input: { q: 'x' } },
      { type: 'tool_use', id: 'tu_so', name: 'StructuredOutput', input: { wrong: 1 } },
    ], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 },
  };
  return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
}}};
const be = new AnthropicBackend({ client: fakeClient,
  tools: [{ name: 'lookup', description: '', input_schema: {type:'object'}, handler: () => 'found' }],
});
be.run({ agentId: 'a1', prompt: 'test',
  schema: { type:'object', required:['id'], properties:{id:{type:'integer'}} },
}).catch(() => {
  const userMsg = apiCalls[1].messages.find(m => m.role==='user' && Array.isArray(m.content));
  console.log('Has tool_result for tu_lookup?', userMsg?.content?.some(b => b.tool_use_id==='tu_lookup'));
});
"
# Output: Has tool_result for tu_lookup? false
```

**Fix:** When StructuredOutput validation fails, still execute the non-StructuredOutput tools and include their results alongside the validation-error message:

```typescript
// backend.ts line 314-322 — replace with:
if (structured !== undefined) {
  const v = validate(structured.input, req.schema as JsonSchema);
  if (v.ok) return { output: structured.input, inputTokens: inTok, outputTokens: outTok };
  const userUses = toolUses.filter((b) => b.name !== "StructuredOutput");
  const toolResults = userUses.length > 0 ? await this._executeTools(userUses) : [];
  messages.push({ role: "assistant", content: msg.content });
  messages.push({
    role: "user",
    content: toolResults.length > 0
      ? [...toolResults, { type: "text" as const, text: "Validation errors: " + v.errors.join("; ") + ". Call StructuredOutput again with a corrected argument." }]
      : "Validation errors: " + v.errors.join("; ") + ". Call StructuredOutput again with a corrected argument.",
  });
  continue;
}
```

---

### Finding 2 — `_executeTools` sends `tool_result` without `content` when handler returns `undefined`

**Severity: HIGH** | `src/backend.ts:275-276`

When a tool handler returns `undefined`, the code takes the non-string branch: `content = JSON.stringify(undefined)`, which evaluates to JS `undefined` (not a string). The `content` key is then **silently omitted** from the serialized `tool_result` block. The Anthropic API requires `content` (a string) on `tool_result` blocks.

**confirmed by:**
```bash
node -e "
const out = undefined;
const content = typeof out === 'string' ? out : JSON.stringify(out);
const block = { type: 'tool_result', tool_use_id: 'tu1', content };
console.log('Serialized:', JSON.stringify(block));
// => {\"type\":\"tool_result\",\"tool_use_id\":\"tu1\"}  — content MISSING
"
```

**Fix:** Guard against `undefined`/`null`:
```typescript
// backend.ts line 276
content = typeof out === "string" ? out : JSON.stringify(out ?? null);
```

---

### Finding 3 — `HttpAgentBackend.run` throws raw `SyntaxError` on non-JSON response body (no URL/status context)

**Severity: MED** | `src/http-agent-backend.ts:68`

When the server returns `200 OK` with a non-JSON body (e.g. an HTML error page), `await res.json()` throws a bare `SyntaxError: Unexpected token < in JSON at position 0` — with no context about the URL, status code, or the fact that the response was non-JSON.

**confirmed by:**
```bash
node -e "
const { HttpAgentBackend } = require('./dist/http-agent-backend.js');
const be = new HttpAgentBackend({ url: 'https://example.com/agent',
  fetchImpl: async () => ({ ok:true, status:200, statusText:'OK',
    json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
  }),
});
be.run({ agentId:'a1', prompt:'test' }).catch(e => {
  console.log(e.constructor.name + ': ' + e.message);
  console.log('Contains URL?', e.message.includes('example.com'));
});
# SyntaxError: Unexpected token < in JSON at position 0
# Contains URL? false
```

**Fix:** Wrap `res.json()` and re-throw with context:
```typescript
// http-agent-backend.ts line 68
let json: unknown;
try {
  json = await res.json();
} catch (e) {
  throw new Error(
    `HttpAgentBackend: ${this.spec.url} returned ${res.status} but body was not valid JSON: ${e instanceof Error ? e.message : String(e)}`
  );
}
```

---

### Finding 4 — `extractJson` O(n²) on adversarial stdout starting with `{` or `[`

**Severity: LOW** (performance / event-loop blocking) | `src/cli-agent-backend.ts:49-58`

The balanced-bracket fallback iterates `end` from `text.length` down to `start+1`, calling `JSON.parse` at each step. For a large input that starts with `{`/`[` but contains no valid JSON, this is O(n²) total characters parsed. Confirmed ~500 ms at 200 KB; would block the event loop for seconds on MB-scale adversarial output.

**confirmed by:**
```bash
node -e "
const { extractJson } = require('./dist/cli-agent-backend.js');
const adversarial = '{' + 'x'.repeat(200000);
const t = Date.now();
extractJson(adversarial);
console.log(Date.now() - t, 'ms for', adversarial.length, 'chars');
"
# 493 ms for 200001 chars
```

**Fix:** Cap the number of iterations (e.g. 10 000) or add an early-exit when the slice length drops below a threshold:
```typescript
// cli-agent-backend.ts — add an iteration cap
const MAX_SHRINK = 10_000;
if (start >= 0) {
  let iterations = 0;
  for (let end = text.length; end > start && iterations < MAX_SHRINK; end--, iterations++) {
    try { return JSON.parse(text.slice(start, end)); } catch { /* keep shrinking */ }
  }
}
```

---

### Finding 5 — MockBackend `synthesize` ignores `items` schema for arrays (always returns `[]`)

**Severity: LOW** | `src/backend.ts:44`

`synthesize` fills **all** declared properties for objects (required + optional) but returns `[]` for every array schema regardless of `items`. A schema `{type: "array", items: {type: "object", …}}` yields an empty array, so downstream pipeline code that iterates over array elements gets nothing. This is inconsistent with the object treatment (which is not "minimal" — it populates everything).

**confirmed by:**
```bash
node -e "
const { MockBackend } = require('./dist/backend.js');
const be = new MockBackend();
be.run({ agentId:'a1', prompt:'t', schema:{
  type:'array', items:{type:'object', required:['id'], properties:{id:{type:'integer'}}}
}}).then(r => console.log('array-of-objects:', JSON.stringify(r.output)));
"
# array-of-objects: []
```

**Fix:** Generate one representative element when `items` is specified:
```typescript
case "array":
  return schema.items !== undefined ? [synthesize(schema.items)] : [];
```
