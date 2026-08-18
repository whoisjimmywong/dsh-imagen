# Security Policy

## Supported versions

Security fixes are provided for the latest tagged release and the current default branch.

## Report a vulnerability

Please use GitHub's [private vulnerability reporting](https://github.com/whoisjimmywong/dsh-imagen/security/advisories/new). Do not open a public issue for a vulnerability.

Include the affected version or commit, DSH version, operating system, reproduction steps, and impact. Remove API keys, private prompts, generated private images, filesystem paths, and unrelated logs before submitting.

If private vulnerability reporting is temporarily unavailable, open a public issue that requests a private contact channel without disclosing technical details.

## Credential and data expectations

- Every source resolves its API key through the DSH credential seam (`ctx.credentials`) at call time. The plugin never persists, logs, or embeds a resolved secret — configuration stores only a credential reference name.
- Provider requests default to HTTPS; plain HTTP is limited to loopback development hosts. Every credential-bearing provider request rejects redirects (`redirect: "error"`).
- Reference image downloads are https-only (loopback http allowed) and byte-bounded; returned images are byte-bounded before decode.
- Final-image RPC reads are loopback-only and authorized against the exact session and call record (live registry plus the session's own tool-result events), so a remote web client never receives image bytes.
- Saved images are written only inside the session workspace (containment-checked), atomically, under the configured save directory.
- Retries happen only for transient provider failures (429/5xx/network); provider policy rejections fail immediately.
