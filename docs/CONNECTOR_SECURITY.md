# Connector Security

Phase 2 adds connector contracts in `src/modules/connectors/`.

Implemented foundations:

- typed Connector SDK metadata and health contracts;
- registry for generic webhook, CSV contacts, and mock business connectors;
- HMAC-SHA256 webhook verification helper with timestamp replay window;
- generic webhook endpoints can enforce encrypted endpoint secrets with `x-tradikom-timestamp` and `x-tradikom-signature`;
- AES-256-GCM encryption/decryption helper for connector secrets;
- robust CSV parsing with delimiter detection, quoted values, and embedded commas.

Remaining work:

- endpoint secret rotation UI;
- redacted payload display;
- file upload and dry-run import UI;
- sync cursor persistence for mock business connector;
- credential key rotation.
