# Trace digest — experiment-03-concurrency

- run dir: `<repo-root>/traces/experiment-03-concurrency/run`
- agents: 30  | journal events: 60  | parse errors: 0

## Journal (append-only, 2-event model)

| seq | type | agentId | key (v2:...) | result preview |
|----|------|---------|--------------|----------------|
| 1 | started | af90ce2abd4ea124e | v2:1d7170a091e61b1 |  |
| 2 | started | a6b8bca84e9d8f2a0 | v2:ee954d6653a8a4b |  |
| 3 | started | acaa00e1452a33c98 | v2:65d53caccaa70a8 |  |
| 4 | started | a529354c3677e07b5 | v2:f98b45738979e04 |  |
| 5 | started | a4613994910c33911 | v2:5dfa204044a7d47 |  |
| 6 | started | a60f7b1582448f370 | v2:e7cdadd31b7397d |  |
| 7 | started | a4d06f2093f0a5628 | v2:bb7a99143fb896b |  |
| 8 | started | a696362361893348c | v2:98c2b7fbddd85a2 |  |
| 9 | started | a04fe7558d32a2f71 | v2:8ff3b0223532e07 |  |
| 10 | started | a9daafb2c6b5ae606 | v2:d7dbaafafe604dc |  |
| 11 | started | ad1019de520d69213 | v2:690156215369e86 |  |
| 12 | started | af11322ca20628d16 | v2:6a3c472f7238aa6 |  |
| 13 | started | add53645c5fc5eded | v2:1b688041966ba80 |  |
| 14 | started | a534dc2c254ba172d | v2:d8bd2e3f2d23ad2 |  |
| 15 | started | ad83441c0854da7e8 | v2:56fc1bc47c538b8 |  |
| 16 | started | a3adb30412252b954 | v2:be7bbfe51f76071 |  |
| 17 | started | a973d9f92a8a3a2cb | v2:5cc84b342987cb3 |  |
| 18 | result | a6b8bca84e9d8f2a0 | v2:ee954d6653a8a4b | "0"… |
| 19 | started | ae683eb5c52d869ec | v2:fba3fed4db48b78 |  |
| 20 | result | a60f7b1582448f370 | v2:e7cdadd31b7397d | "2"… |
| 21 | started | a90d69d20be6ceab7 | v2:75689b3454b405d |  |
| 22 | result | af90ce2abd4ea124e | v2:1d7170a091e61b1 | "8"… |
| 23 | started | a8de6a4f492112859 | v2:fc89166a8d44963 |  |
| 24 | result | add53645c5fc5eded | v2:1b688041966ba80 | "6"… |
| 25 | started | a38895d4fdd14cc13 | v2:fa8e08a67a8c81d |  |
| 26 | result | a696362361893348c | v2:98c2b7fbddd85a2 | "10"… |
| 27 | started | aef84719fc5acfc7a | v2:c1bd335f024275b |  |
| 28 | result | a4d06f2093f0a5628 | v2:bb7a99143fb896b | "15"… |
| 29 | started | a715da5744eef4a5e | v2:49bd8ac422b5559 |  |
| 30 | result | a04fe7558d32a2f71 | v2:8ff3b0223532e07 | "1"… |
| 31 | started | adbee02cf2abd00ac | v2:75b87ec53226147 |  |
| 32 | result | a4613994910c33911 | v2:5dfa204044a7d47 | "11"… |
| 33 | started | a1af7eb27805f540e | v2:4a46437b7543f9b |  |
| 34 | result | ad83441c0854da7e8 | v2:56fc1bc47c538b8 | "5"… |
| 35 | started | a3457e6703e6fd084 | v2:bb5611687e7193e |  |
| 36 | result | a3adb30412252b954 | v2:be7bbfe51f76071 | "3"… |
| 37 | started | a0978dabc98a63dc3 | v2:5f8bc1095b5aa86 |  |
| 38 | result | a534dc2c254ba172d | v2:d8bd2e3f2d23ad2 | "4"… |
| 39 | started | aa34f4c0d5a6d5403 | v2:9f9a880e443d0c9 |  |
| 40 | result | ad1019de520d69213 | v2:690156215369e86 | "9"… |
| 41 | started | a081cf1b1f799ed77 | v2:08f671ecb97962e |  |
| 42 | result | af11322ca20628d16 | v2:6a3c472f7238aa6 | "13"… |
| 43 | started | ab71bd100cf0858ea | v2:3c97b4d4c6b5fe4 |  |
| 44 | result | acaa00e1452a33c98 | v2:65d53caccaa70a8 | "12"… |
| 45 | result | a9daafb2c6b5ae606 | v2:d7dbaafafe604dc | "14"… |
| 46 | result | a973d9f92a8a3a2cb | v2:5cc84b342987cb3 | "16"… |
| 47 | result | a529354c3677e07b5 | v2:f98b45738979e04 | "7"… |
| 48 | result | ae683eb5c52d869ec | v2:fba3fed4db48b78 | "17"… |
| 49 | result | a8de6a4f492112859 | v2:fc89166a8d44963 | "19"… |
| 50 | result | a90d69d20be6ceab7 | v2:75689b3454b405d | "18"… |
| 51 | result | a38895d4fdd14cc13 | v2:fa8e08a67a8c81d | "20"… |
| 52 | result | aef84719fc5acfc7a | v2:c1bd335f024275b | "21"… |
| 53 | result | a715da5744eef4a5e | v2:49bd8ac422b5559 | "22"… |
| 54 | result | aa34f4c0d5a6d5403 | v2:9f9a880e443d0c9 | "27"… |
| 55 | result | a3457e6703e6fd084 | v2:bb5611687e7193e | "25"… |
| 56 | result | adbee02cf2abd00ac | v2:75b87ec53226147 | "23"… |
| 57 | result | a1af7eb27805f540e | v2:4a46437b7543f9b | "24"… |
| 58 | result | a081cf1b1f799ed77 | v2:08f671ecb97962e | "28"… |
| 59 | result | a0978dabc98a63dc3 | v2:5f8bc1095b5aa86 | "26"… |
| 60 | result | ab71bd100cf0858ea | v2:3c97b4d4c6b5fe4 | "29"… |

## Agents (per-subagent ground truth)

### a04fe7558d32a2f71  (agent-a04fe7558d32a2f71.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:17.870000+00:00 → 2026-05-28T19:12:23.296000+00:00  (5.426s)
- journal_key: `v2:8ff3b0223532e07cdc5c3b831d76ffc84adba7ac0332119d0a9e2caa1da62181`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 1 and nothing else.…`
- result: `"1"`

### a081cf1b1f799ed77  (agent-a081cf1b1f799ed77.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:23.887000+00:00 → 2026-05-28T19:12:28.609000+00:00  (4.722s)
- journal_key: `v2:08f671ecb97962e605e442ce2998cb765480b055a21d806b8ec708daeb7f50df`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 28 and nothing else.…`
- result: `"28"`

### a0978dabc98a63dc3  (agent-a0978dabc98a63dc3.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:23.618000+00:00 → 2026-05-28T19:12:28.457000+00:00  (4.839s)
- journal_key: `v2:5f8bc1095b5aa86379c7ae3d4fd4969990ef0ae602789d869cce95bf07c7ef64`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 26 and nothing else.…`
- result: `"26"`

### a1af7eb27805f540e  (agent-a1af7eb27805f540e.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 5, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:23.506000+00:00 → 2026-05-28T19:12:28.415000+00:00  (4.909s)
- journal_key: `v2:4a46437b7543f9ba7c901d11b00942fd2bb12622877ba58b057a88827a4a63a7`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 24 and nothing else.…`
- result: `"24"`

### a3457e6703e6fd084  (agent-a3457e6703e6fd084.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:23.515000+00:00 → 2026-05-28T19:12:28.358000+00:00  (4.843s)
- journal_key: `v2:bb5611687e7193e579e4b4d30352de8840f088cadaec880b25fcdace2c92ed36`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 25 and nothing else.…`
- result: `"25"`

### a38895d4fdd14cc13  (agent-a38895d4fdd14cc13.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:23.123000+00:00 → 2026-05-28T19:12:27.636000+00:00  (4.513s)
- journal_key: `v2:fa8e08a67a8c81d80511357fc9393dda0ef63d6f57d677fef8581aadc5686c32`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 20 and nothing else.…`
- result: `"20"`

### a3adb30412252b954  (agent-a3adb30412252b954.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:17.871000+00:00 → 2026-05-28T19:12:23.455000+00:00  (5.584s)
- journal_key: `v2:be7bbfe51f76071a899159ecf8612a9ab1f655681446282f6e1f56493f6d89b8`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 3 and nothing else.…`
- result: `"3"`

### a4613994910c33911  (agent-a4613994910c33911.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 5, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:17.876000+00:00 → 2026-05-28T19:12:23.317000+00:00  (5.441s)
- journal_key: `v2:5dfa204044a7d478923284d0c63856c1d80dfaa060281155104c43eae83176d3`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 11 and nothing else.…`
- result: `"11"`

### a4d06f2093f0a5628  (agent-a4d06f2093f0a5628.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:17.879000+00:00 → 2026-05-28T19:12:23.206000+00:00  (5.327s)
- journal_key: `v2:bb7a99143fb896bfa43c5e796c2e945d8c200028793196ad8fa3c3964566f697`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 15 and nothing else.…`
- result: `"15"`

### a529354c3677e07b5  (agent-a529354c3677e07b5.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 5, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:17.873000+00:00 → 2026-05-28T19:12:24.573000+00:00  (6.7s)
- journal_key: `v2:f98b45738979e04446c38ee8070fa343a51e2b802262ccfdef3964356dc0bd60`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 7 and nothing else.…`
- result: `"7"`

### a534dc2c254ba172d  (agent-a534dc2c254ba172d.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:17.871000+00:00 → 2026-05-28T19:12:23.530000+00:00  (5.659s)
- journal_key: `v2:d8bd2e3f2d23ad2587c396889792ce4936e4b7a138b1ed4c48a18555ba504cd7`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 4 and nothing else.…`
- result: `"4"`

### a60f7b1582448f370  (agent-a60f7b1582448f370.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:17.870000+00:00 → 2026-05-28T19:12:22.419000+00:00  (4.549s)
- journal_key: `v2:e7cdadd31b7397d4182e8a1892ae5e78035ed988daf74018f6355eb52e8abd69`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 2 and nothing else.…`
- result: `"2"`

### a696362361893348c  (agent-a696362361893348c.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:17.875000+00:00 → 2026-05-28T19:12:23.038000+00:00  (5.163s)
- journal_key: `v2:98c2b7fbddd85a2a80881203e0725ffaba13bcd2e89518a1675eeff5bab4d52c`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 10 and nothing else.…`
- result: `"10"`

### a6b8bca84e9d8f2a0  (agent-a6b8bca84e9d8f2a0.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:17.869000+00:00 → 2026-05-28T19:12:22.024000+00:00  (4.155s)
- journal_key: `v2:ee954d6653a8a4bb0cac2cfe8b1611a99d30d989792835f065827433bfd0e3a1`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 0 and nothing else.…`
- result: `"0"`

### a715da5744eef4a5e  (agent-a715da5744eef4a5e.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:23.445000+00:00 → 2026-05-28T19:12:27.773000+00:00  (4.328s)
- journal_key: `v2:49bd8ac422b5559b3378ead2ce28fbd5d7297923ceb36471935e559ecded3c41`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 22 and nothing else.…`
- result: `"22"`

### a8de6a4f492112859  (agent-a8de6a4f492112859.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 5, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:22.794000+00:00 → 2026-05-28T19:12:26.857000+00:00  (4.063s)
- journal_key: `v2:fc89166a8d449633ceafe39d907a9f3e42e0356686f1e26524d764c6ec6caa22`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 19 and nothing else.…`
- result: `"19"`

### a90d69d20be6ceab7  (agent-a90d69d20be6ceab7.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:22.725000+00:00 → 2026-05-28T19:12:27.118000+00:00  (4.393s)
- journal_key: `v2:75689b3454b405d5edb0f37ddfb66835d4299bfccb571af5ef5fa0fa258865c1`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 18 and nothing else.…`
- result: `"18"`

### a973d9f92a8a3a2cb  (agent-a973d9f92a8a3a2cb.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:22.120000+00:00 → 2026-05-28T19:12:24.090000+00:00  (1.97s)
- journal_key: `v2:5cc84b342987cb3e1ad7cae40da011bb5e6f101233d964a977c69ba8042fea2f`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 16 and nothing else.…`
- result: `"16"`

### a9daafb2c6b5ae606  (agent-a9daafb2c6b5ae606.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:17.878000+00:00 → 2026-05-28T19:12:23.918000+00:00  (6.04s)
- journal_key: `v2:d7dbaafafe604dcaf78d13eaee040f8e87272b6f3b796235c8d72daeeffc9a0c`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 14 and nothing else.…`
- result: `"14"`

### aa34f4c0d5a6d5403  (agent-aa34f4c0d5a6d5403.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:23.712000+00:00 → 2026-05-28T19:12:27.859000+00:00  (4.147s)
- journal_key: `v2:9f9a880e443d0c9fd886af7d6c3296cf120d7482bf35baf34937a9ece0017206`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 27 and nothing else.…`
- result: `"27"`

### ab71bd100cf0858ea  (agent-ab71bd100cf0858ea.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:23.995000+00:00 → 2026-05-28T19:12:28.886000+00:00  (4.891s)
- journal_key: `v2:3c97b4d4c6b5fe49f8f3ba409dbc0f8483e02645ee136108adfa0b75202846c5`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 29 and nothing else.…`
- result: `"29"`

### acaa00e1452a33c98  (agent-acaa00e1452a33c98.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 5, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:17.877000+00:00 → 2026-05-28T19:12:23.920000+00:00  (6.043s)
- journal_key: `v2:65d53caccaa70a8608a8443c7278acdb00bd24481b0f185e96cf70d33214ef4a`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 12 and nothing else.…`
- result: `"12"`

### ad1019de520d69213  (agent-ad1019de520d69213.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:17.875000+00:00 → 2026-05-28T19:12:23.631000+00:00  (5.756s)
- journal_key: `v2:690156215369e86a6f139f66abdc97c0b86db681fb3fa7e4f9439358cf4de152`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 9 and nothing else.…`
- result: `"9"`

### ad83441c0854da7e8  (agent-ad83441c0854da7e8.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:17.872000+00:00 → 2026-05-28T19:12:23.439000+00:00  (5.567s)
- journal_key: `v2:56fc1bc47c538b887df0da566ede5f1539fb6dba0e2edf89252aadce5d7e59e4`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 5 and nothing else.…`
- result: `"5"`

### adbee02cf2abd00ac  (agent-adbee02cf2abd00ac.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:23.454000+00:00 → 2026-05-28T19:12:28.416000+00:00  (4.962s)
- journal_key: `v2:75b87ec53226147ca2f5fef44b49f7fda2e30bab6ccafc9574979ace464f7d88`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 23 and nothing else.…`
- result: `"23"`

### add53645c5fc5eded  (agent-add53645c5fc5eded.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:17.873000+00:00 → 2026-05-28T19:12:22.744000+00:00  (4.871s)
- journal_key: `v2:1b688041966ba804c9717dce17ab9a0ee4954981cf24b536d54af6dbc38933aa`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 6 and nothing else.…`
- result: `"6"`

### ae683eb5c52d869ec  (agent-ae683eb5c52d869ec.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:22.496000+00:00 → 2026-05-28T19:12:26.400000+00:00  (3.904s)
- journal_key: `v2:fba3fed4db48b78167105597fc5b54c8b4f1308324daa7c12b7058e45d2d1f04`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 17 and nothing else.…`
- result: `"17"`

### aef84719fc5acfc7a  (agent-aef84719fc5acfc7a.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:23.289000+00:00 → 2026-05-28T19:12:27.671000+00:00  (4.382s)
- journal_key: `v2:c1bd335f024275b20faae49e9d3c427458c339d8804fea37170c84cd8f22499c`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 21 and nothing else.…`
- result: `"21"`

### af11322ca20628d16  (agent-af11322ca20628d16.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "output_tokens": 5, "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": 5824, "ephemeral_5m_input_tokens": 0}, "inference_geo": "not_available", "iterations": [{"input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 109356, "cache_creation_input_tokens": 5824, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "type": "message"}], "speed": "standard"}`
- window: 2026-05-28T19:12:17.878000+00:00 → 2026-05-28T19:12:23.836000+00:00  (5.958s)
- journal_key: `v2:6a3c472f7238aa69b4e97468af2f183de27c0e89d347c18d1f2aada95af161ef`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 13 and nothing else.…`
- result: `"13"`

### af90ce2abd4ea124e  (agent-af90ce2abd4ea124e.jsonl)
- model: `claude-haiku-4-5-20251001`  | events: 3  | result_kind: **text**
- usage: `{"input_tokens": 3, "cache_creation_input_tokens": 5824, "cache_read_input_tokens": 109356, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 5824}, "output_tokens": 1, "service_tier": "standard", "inference_geo": "not_available"}`
- window: 2026-05-28T19:12:17.874000+00:00 → 2026-05-28T19:12:22.595000+00:00  (4.721s)
- journal_key: `v2:1d7170a091e61b17ee898ddb47e5ce20c315d326ac7ed2ac11e8bfd467d4aa11`  | result_matches_journal: True
- tools: []
- prompt: `Reply with ONLY the integer 8 and nothing else.…`
- result: `"8"`

## Concurrency evidence (real wall-clock intervals)

Sorted by start; overlaps prove concurrent execution.

| agentId | start | end |
|---------|-------|-----|
| a6b8bca84e9d8f2a0 | 2026-05-28T19:12:17.869000+00:00 | 2026-05-28T19:12:22.024000+00:00 |
| a04fe7558d32a2f71 | 2026-05-28T19:12:17.870000+00:00 | 2026-05-28T19:12:23.296000+00:00 |
| a60f7b1582448f370 | 2026-05-28T19:12:17.870000+00:00 | 2026-05-28T19:12:22.419000+00:00 |
| a3adb30412252b954 | 2026-05-28T19:12:17.871000+00:00 | 2026-05-28T19:12:23.455000+00:00 |
| a534dc2c254ba172d | 2026-05-28T19:12:17.871000+00:00 | 2026-05-28T19:12:23.530000+00:00 |
| ad83441c0854da7e8 | 2026-05-28T19:12:17.872000+00:00 | 2026-05-28T19:12:23.439000+00:00 |
| a529354c3677e07b5 | 2026-05-28T19:12:17.873000+00:00 | 2026-05-28T19:12:24.573000+00:00 |
| add53645c5fc5eded | 2026-05-28T19:12:17.873000+00:00 | 2026-05-28T19:12:22.744000+00:00 |
| af90ce2abd4ea124e | 2026-05-28T19:12:17.874000+00:00 | 2026-05-28T19:12:22.595000+00:00 |
| a696362361893348c | 2026-05-28T19:12:17.875000+00:00 | 2026-05-28T19:12:23.038000+00:00 |
| ad1019de520d69213 | 2026-05-28T19:12:17.875000+00:00 | 2026-05-28T19:12:23.631000+00:00 |
| a4613994910c33911 | 2026-05-28T19:12:17.876000+00:00 | 2026-05-28T19:12:23.317000+00:00 |
| acaa00e1452a33c98 | 2026-05-28T19:12:17.877000+00:00 | 2026-05-28T19:12:23.920000+00:00 |
| a9daafb2c6b5ae606 | 2026-05-28T19:12:17.878000+00:00 | 2026-05-28T19:12:23.918000+00:00 |
| af11322ca20628d16 | 2026-05-28T19:12:17.878000+00:00 | 2026-05-28T19:12:23.836000+00:00 |
| a4d06f2093f0a5628 | 2026-05-28T19:12:17.879000+00:00 | 2026-05-28T19:12:23.206000+00:00 |
| a973d9f92a8a3a2cb | 2026-05-28T19:12:22.120000+00:00 | 2026-05-28T19:12:24.090000+00:00 |
| ae683eb5c52d869ec | 2026-05-28T19:12:22.496000+00:00 | 2026-05-28T19:12:26.400000+00:00 |
| a90d69d20be6ceab7 | 2026-05-28T19:12:22.725000+00:00 | 2026-05-28T19:12:27.118000+00:00 |
| a8de6a4f492112859 | 2026-05-28T19:12:22.794000+00:00 | 2026-05-28T19:12:26.857000+00:00 |
| a38895d4fdd14cc13 | 2026-05-28T19:12:23.123000+00:00 | 2026-05-28T19:12:27.636000+00:00 |
| aef84719fc5acfc7a | 2026-05-28T19:12:23.289000+00:00 | 2026-05-28T19:12:27.671000+00:00 |
| a715da5744eef4a5e | 2026-05-28T19:12:23.445000+00:00 | 2026-05-28T19:12:27.773000+00:00 |
| adbee02cf2abd00ac | 2026-05-28T19:12:23.454000+00:00 | 2026-05-28T19:12:28.416000+00:00 |
| a1af7eb27805f540e | 2026-05-28T19:12:23.506000+00:00 | 2026-05-28T19:12:28.415000+00:00 |
| a3457e6703e6fd084 | 2026-05-28T19:12:23.515000+00:00 | 2026-05-28T19:12:28.358000+00:00 |
| a0978dabc98a63dc3 | 2026-05-28T19:12:23.618000+00:00 | 2026-05-28T19:12:28.457000+00:00 |
| aa34f4c0d5a6d5403 | 2026-05-28T19:12:23.712000+00:00 | 2026-05-28T19:12:27.859000+00:00 |
| a081cf1b1f799ed77 | 2026-05-28T19:12:23.887000+00:00 | 2026-05-28T19:12:28.609000+00:00 |
| ab71bd100cf0858ea | 2026-05-28T19:12:23.995000+00:00 | 2026-05-28T19:12:28.886000+00:00 |
