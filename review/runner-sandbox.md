> Historical adversarial-review artifact. This is not the current vulnerability list; see `review/README.md` and `PROGRESS.md` for current status.

Now I have all the evidence. Let me compile the final findings:

---

## Runner-Sandbox Adversarial Review — Verified Findings

### 1. `parseMeta` picks wrong meta from string/regex literals — HIGH

**File:** `src/runner.ts:125`

`scan.match(/export\s+const\s+meta\s*=/)` searches the entire blanked source, including the interior of string and regex literals. A string like `'export const meta = { name: "fake", description: "stolen" }'` or a regex like `/export const meta = { name: "rx", description: "rx" }/` appearing *before* the real declaration causes `parseMeta` to extract the wrong object.

**Root cause:** `blankComments` blanks comments but preserves string content. `scan.match()` at line 125 is not context-aware — it cannot distinguish a match inside a literal from a real `export const meta =` declaration. `blankComments` also does not blank regex literals at all.

**Confirmed by:**
```js
// /tmp/test_final_confirmation.js
const src = "const msg = 'export const meta = { name: \"injection\", description: \"stolen\" }';\nexport const meta = { name: 'real', description: 'real workflow' };";
parseMeta(src);  // → {"name":"injection","description":"stolen"}  WRONG
```

**Fix:** After `scan.match()` at line 125, validate that the match is not inside a string or regex literal by replaying `blankComments`' state machine up to `match.index` and confirming the match position is in "code" context (not inside a string/regex). Alternatively, replace the regex match with a stateful scanner that skips string/regex literals, only matching `export const meta =` when `inStr === null` and not inside a regex.

---

### 2. `blankComments` and brace balancer don't handle `\`` escapes in template literals — MED

**File:** `src/runner.ts:77` (blankComments) and `src/runner.ts:148` (brace balancer)

Both functions have `ch === "\\" && inStr !== "\`"` which deliberately skips escape handling for backtick strings. This means `\`` inside a template literal is treated as the closing backtick, not an escaped backtick.

In **blankComments** (line 77): this causes premature exit from template mode. If `//` or `/*` follows on the same line (still inside the real template), blankComments incorrectly blanks real code as a comment, potentially erasing the `export const meta =` declaration.

In the **brace balancer** (line 148): this causes a valid meta literal like `` { name: `a\`b`, description: "desc" } `` to fail with "unbalanced braces", because the balancer exits the template at `\``, then the subsequent `b` is treated as code, and the next `` ` `` starts a new template that swallows the closing `}`.

**Confirmed by:**
```js
// blankComments — // inside template after \`
const src = 'const s = `a\\`b // inside template`; export const meta = { name: "test", description: "desc" };';
parseMeta(src);  // throws: no 'export const meta =' found

// brace balancer — \`` in meta value
const src = 'export const meta = { name: `a\\`b`, description: "desc" };';
parseMeta(src);  // throws: unbalanced braces
```

**Fix:** Change `inStr !== "\`"` to `true` (or just remove the condition) in both locations (lines 77 and 148), so that `\` inside a template literal correctly skips the next character — same as for `"` and `'` strings:
```ts
// Line 77 and 148 — change:
if (ch === "\\" && inStr !== "`") {
// to:
if (ch === "\\") {
```

---

### 3. `blankComments` treats regex literal content as comments — MED

**File:** `src/runner.ts:92–111`

`blankComments` has no awareness of regex literals. When a regex like `/\/*/` (valid JS — matches zero or more `/`) appears in source, blankComments sees `/*` at the regex boundary and enters block-comment blanking mode, blanking everything until it finds `*/`. If no `*/` follows, the entire rest of the source (including `export const meta =`) is blanked.

**Confirmed by:**
```js
const src = 'const r = /\\/*/;\nexport const meta = { name: "test", description: "desc" };';
parseMeta(src);  // throws: no 'export const meta =' found
// /\/*/ is a valid regex: node -e "console.log(/\/*/)" → /\/*/
```

**Fix:** Add regex literal tracking to `blankComments`. After a regex-opening `/` (detected by tracking whether the previous token is an expression or operator), skip to the closing `/` plus any flags. A simpler approximation: after detecting the match at line 125 is in code context (fix #1), this becomes less critical since the match position is validated; but `blankComments` could still mangle source. A full fix requires tracking division-vs-regex context, which is non-trivial without a parser. Alternatively, replace `blankComments` + regex match with a single stateful scanner that handles all literal types (string, template, regex) in one pass.
