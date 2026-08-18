# Contributing

Contributions are welcome through focused issues and pull requests.

## Setup

Requirements:

- Node.js 22.19 or newer (Node.js 24 is also tested).
- DeepSeek Harness 0.1.0-rc.6 or newer compatible prerelease.

```powershell
npm ci
npm run check
```

`npm run check` typechecks both platforms, runs the keyless transport/save/config/component suite, builds Host and browser bundles, executes the built-artifact smoke test, and validates package metadata. For a real-key-free end-to-end pass, start the bundled mock server (`node scripts/mock-image-api.mjs`) and point a source at `http://127.0.0.1:8787/v1`.

## Changes

- Keep Host side effects owned by the Cordis fiber and await asynchronous teardown.
- Keep the model-facing result text-only. Image references belong in versioned presentation metadata and the bounded Code Mode replay marker.
- Treat RPC payloads, provider responses, and durable session records as untrusted JSON.
- Reject credential-bearing redirects and preserve all response/size limits.
- Keep saved paths inside the session workspace; never write outside it.
- Update `lib/index.js`, `lib/client.js`, and `lib/client.js.map` with every source change (the repo ships built bundles).
- Update both English and Chinese documentation for user-visible behavior.
- Add regression coverage for changed transport, lifecycle, save, discovery, or card behavior.

## Real provider checks

The default suite never reads real API keys. If you manually exercise a paid endpoint, review the selected account's billing first, and never attach a token, private prompt, or private generated image to an issue.

## Security

Do not report vulnerabilities in a public issue. Follow [SECURITY.md](./SECURITY.md).
