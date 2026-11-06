# Codex token accounting

Codex `output_tokens` includes reasoning output. `reasoning_output_tokens` is a breakdown and must not be added a second time. Quotanest keeps cached input separate, so total input plus output remains input_tokens + output_tokens.

Verified against the official Codex source on 2026-11-06:
https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs

`TokenUsage::blended_total` sums `non_cached_input()` and `output_tokens` only. Regression coverage uses input=1000, cached=400, output=100, reasoning=20 and expects output=100, full total=1100.
