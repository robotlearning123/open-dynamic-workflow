# Trace digest — experiment-01

- run dir: `<repo-root>/traces/experiment-01/run`
- agents: 8  | journal events: 16  | parse errors: 0

## Journal (append-only, 2-event model)

| seq | type | agentId | key (v2:...) | result preview |
|----|------|---------|--------------|----------------|
| 1 | started | a68c0e47121ce5227 | v2:b90252fd96dab60 |  |
| 2 | started | a121115b7b37b5c30 | v2:15db82de81eb30d |  |
| 3 | started | ab93e096ab0124880 | v2:b35253f62136c17 |  |
| 4 | result | a121115b7b37b5c30 | v2:15db82de81eb30d | {"id": 0, "primitive": "parallel-barrier", "note":… |
| 5 | result | a68c0e47121ce5227 | v2:b90252fd96dab60 | {"id": 2, "primitive": "schema-output", "note": "F… |
| 6 | result | ab93e096ab0124880 | v2:b35253f62136c17 | {"id": 1, "primitive": "concurrency-cap", "note": … |
| 7 | started | a3430465e7f877557 | v2:a607e66739a039a |  |
| 8 | started | a5c58063469a80539 | v2:0ec60850c3a90bb |  |
| 9 | result | a5c58063469a80539 | v2:0ec60850c3a90bb | {"id": 1, "primitive": "pipeline:no-barrier", "not… |
| 10 | started | ab8495e020517bd52 | v2:8e674c5dd6583a5 |  |
| 11 | result | a3430465e7f877557 | v2:a607e66739a039a | {"id": 0, "primitive": "pipeline:stage-semantics",… |
| 12 | started | a6f9ac3be866a4996 | v2:e901f44d177740d |  |
| 13 | result | a6f9ac3be866a4996 | v2:e901f44d177740d | "Received stage-1 id=0, primitive=\"pipeline:stage… |
| 14 | result | ab8495e020517bd52 | v2:8e674c5dd6583a5 | "Received stage-1 id=1 for originalItem=\"no-barri… |
| 15 | started | a045f01fb09cd51c6 | v2:f7ec08a98d8e834 |  |
| 16 | result | a045f01fb09cd51c6 | v2:f7ec08a98d8e834 | "Two fanout primitives were exercised (parallel-ba… |

## Agents (per-subagent ground truth)

### a045f01fb09cd51c6  (agent-a045f01fb09cd51c6.jsonl)
- model: `claude-sonnet-4-6`  | events: 4  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 15673, "cache_read_input_tokens": 0, "output_tokens": 98, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 15673, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 98, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 15673, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 15673}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T18:58:01.944000+00:00 → 2026-05-28T18:58:06.330000+00:00  (4.386s)
- journal_key: `v2:f7ec08a98d8e83455c6271e8d687d49854555ef18e531df4034986c0df67509a`  | result_matches_journal: True
- tools: []
- prompt: `You are the synthesizer. Fanout results: [{"id":0,"primitive":"parallel-barrier","note":"waits for all parallel branches to finish"},{"id":1,"primitive":"concur…`
- result: `"Two fanout primitives were exercised (parallel-barrier and concurrency-cap), plus schema-output for result formatting, while the pipeline exercised pipeline:stage-semantics and pipeline:no-barrier ac`

### a121115b7b37b5c30  (agent-a121115b7b37b5c30.jsonl)
- model: `claude-sonnet-4-6`  | events: 5  | result_kind: **structured**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 15672, "cache_read_input_tokens": 0, "output_tokens": 98, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 15672, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 98, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 15672, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 15672}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T18:57:32.142000+00:00 → 2026-05-28T18:57:34.876000+00:00  (2.734s)
- journal_key: `v2:15db82de81eb30d857c9a170bc26f930b6b699eb5052f3e303539c44a21e3ca4`  | result_matches_journal: True
- tools: ['StructuredOutput']
- prompt: `You are probe #0. Return id=0, primitive="parallel-barrier", and a note of at most 6 words describing what the "parallel-barrier" aspect of a dynamic workflow d…`
- result: `{"id": 0, "primitive": "parallel-barrier", "note": "waits for all parallel branches to finish"}`

### a3430465e7f877557  (agent-a3430465e7f877557.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 6  | result_kind: **structured**
- usage: `{"input_tokens": 5, "cache_creation_input_tokens": 408, "cache_read_input_tokens": 115862, "output_tokens": 41, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 408, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 5, "output_tokens": 41, "cache_read_input_tokens": 115862, "cache_creation_input_tokens": 408, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 408}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T18:57:53.015000+00:00 → 2026-05-28T18:57:58.066000+00:00  (5.051s)
- journal_key: `v2:a607e66739a039a5b56f65b1ff9731981c3ba94997686820f5b54cd06bf50d5b`  | result_matches_journal: True
- tools: ['StructuredOutput']
- prompt: `Pipeline stage-1, index=0, item="stage-semantics". Return id=0, primitive="pipeline:stage-semantics", note of at most 6 words.…`
- result: `{"id": 0, "primitive": "pipeline:stage-semantics", "note": "Semantic analysis pipeline stage"}`

### a5c58063469a80539  (agent-a5c58063469a80539.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 4  | result_kind: **structured**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5848, "cache_read_input_tokens": 110012, "output_tokens": 97, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5848, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 97, "cache_read_input_tokens": 110012, "cache_creation_input_tokens": 5848, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5848}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T18:57:53.016000+00:00 → 2026-05-28T18:57:55.182000+00:00  (2.166s)
- journal_key: `v2:0ec60850c3a90bb4eec46807286bd96ef035766db526bfd5c4e19d272b237e70`  | result_matches_journal: True
- tools: ['StructuredOutput']
- prompt: `Pipeline stage-1, index=1, item="no-barrier". Return id=1, primitive="pipeline:no-barrier", note of at most 6 words.…`
- result: `{"id": 1, "primitive": "pipeline:no-barrier", "note": "no-barrier stage complete"}`

### a68c0e47121ce5227  (agent-a68c0e47121ce5227.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 5  | result_kind: **structured**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 115865, "cache_read_input_tokens": 0, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 115865}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T18:57:32.144000+00:00 → 2026-05-28T18:57:35.783000+00:00  (3.639s)
- journal_key: `v2:b90252fd96dab60005f070f4272f48fbd2237497c0dd303fbe0710d89ee2abbf`  | result_matches_journal: True
- tools: ['StructuredOutput']
- prompt: `You are probe #2. Return id=2, primitive="schema-output", and a note of at most 6 words describing what the "schema-output" aspect of a dynamic workflow does.…`
- result: `{"id": 2, "primitive": "schema-output", "note": "Formats result into required data structure"}`

### a6f9ac3be866a4996  (agent-a6f9ac3be866a4996.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 115771, "cache_read_input_tokens": 0, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 115771}, "output_tokens": 2, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T18:57:58.126000+00:00 → 2026-05-28T18:57:59.560000+00:00  (1.434s)
- journal_key: `v2:e901f44d177740dfb50fce9a81b43c937c8af33b241cf90f9373009efce688c4`  | result_matches_journal: True
- tools: []
- prompt: `Pipeline stage-2, index=0, originalItem="stage-semantics". You received this stage-1 JSON: {"id":0,"primitive":"pipeline:stage-semantics","note":"Semantic analy…`
- result: `"Received stage-1 id=0, primitive=\"pipeline:stage-semantics\" for originalItem=\"stage-semantics\"."`

### ab8495e020517bd52  (agent-ab8495e020517bd52.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 115769, "cache_read_input_tokens": 0, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 115769}, "output_tokens": 7, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T18:57:57.010000+00:00 → 2026-05-28T18:58:01.821000+00:00  (4.811s)
- journal_key: `v2:8e674c5dd6583a5fba230ad7a879d8974616c375291482a7ed07c26e8eb0abb9`  | result_matches_journal: True
- tools: []
- prompt: `Pipeline stage-2, index=1, originalItem="no-barrier". You received this stage-1 JSON: {"id":1,"primitive":"pipeline:no-barrier","note":"no-barrier stage complet…`
- result: `"Received stage-1 id=1 for originalItem=\"no-barrier\" with primitive=\"pipeline:no-barrier\"."`

### ab93e096ab0124880  (agent-ab93e096ab0124880.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 18  | result_kind: **structured**
- usage: `{"input_tokens": 5, "cache_creation_input_tokens": 1515, "cache_read_input_tokens": 116628, "output_tokens": 253, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 1515, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 5, "output_tokens": 253, "cache_read_input_tokens": 116628, "cache_creation_input_tokens": 1515, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 1515}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T18:57:32.143000+00:00 → 2026-05-28T18:57:50.946000+00:00  (18.803s)
- journal_key: `v2:b35253f62136c17878b0e2a2bdc81e7b4e956e86b2ce0ad377844ad67748b6cd`  | result_matches_journal: True
- tools: ['Bash', 'Bash', 'mcp__filesystem__list_directory', 'mcp__filesystem__list_directory', 'mcp__filesystem__read_text_file', 'StructuredOutput']
- prompt: `You are probe #1. Return id=1, primitive="concurrency-cap", and a note of at most 6 words describing what the "concurrency-cap" aspect of a dynamic workflow doe…`
- result: `{"id": 1, "primitive": "concurrency-cap", "note": "Limits maximum parallel concurrent operations"}`

## Concurrency evidence (real wall-clock intervals)

Sorted by start; overlaps prove concurrent execution.

| agentId | start | end |
|---------|-------|-----|
| a121115b7b37b5c30 | 2026-05-28T18:57:32.142000+00:00 | 2026-05-28T18:57:34.876000+00:00 |
| ab93e096ab0124880 | 2026-05-28T18:57:32.143000+00:00 | 2026-05-28T18:57:50.946000+00:00 |
| a68c0e47121ce5227 | 2026-05-28T18:57:32.144000+00:00 | 2026-05-28T18:57:35.783000+00:00 |
| a3430465e7f877557 | 2026-05-28T18:57:53.015000+00:00 | 2026-05-28T18:57:58.066000+00:00 |
| a5c58063469a80539 | 2026-05-28T18:57:53.016000+00:00 | 2026-05-28T18:57:55.182000+00:00 |
| ab8495e020517bd52 | 2026-05-28T18:57:57.010000+00:00 | 2026-05-28T18:58:01.821000+00:00 |
| a6f9ac3be866a4996 | 2026-05-28T18:57:58.126000+00:00 | 2026-05-28T18:57:59.560000+00:00 |
| a045f01fb09cd51c6 | 2026-05-28T18:58:01.944000+00:00 | 2026-05-28T18:58:06.330000+00:00 |
