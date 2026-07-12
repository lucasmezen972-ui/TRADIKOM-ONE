# AI Provider

AI access now goes through `src/modules/ai/provider.ts`.

Providers:

- `DeterministicAiProvider`: always available, no external credentials.
- `OpenAiProvider`: constructed only when `FEATURE_AI_GENERATION=true` and `OPENAI_API_KEY` exists.

Outputs are validated with Zod and include provider, model, prompt version, output, usage metadata, and approval status.

No generated content is automatically published. The current implementation keeps deterministic fallback behavior for the product flow.

Remaining work:

- persist generation records from live flows;
- add fake provider tests for failures and schema validation;
- add prompt-injection handling for imported documents;
- implement real structured OpenAI calls instead of fallback-wrapped output.
