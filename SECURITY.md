# Security

This is a local, single-user demo. It is not a hardened public API service.
API keys belong only in ignored server environment files. Never commit keys,
customer records, local database files, or exported reports.

Do not run code or install dependencies from untrusted pull requests with your API
keys available. Incoming PRs do not execute GitHub Actions in this repository.
Contact the maintainer through GitHub private vulnerability reporting for security
issues; do not post credentials or exploit details in public issues.

Repository settings require code-owner approval for contributor PRs, disable
auto-merge and Actions, and prevent non-admin force pushes and branch deletion.
The owner retains administrative control and can bypass branch rules for maintenance.
Forking a public repository does not grant permission to change this repository.

Before hosting for other users, implement authentication, authorization, per-user
history isolation, quotas, and abuse controls. Origin checks alone are not authentication.
