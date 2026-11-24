# Personal Budget Buckets: Team 04 (AI-assisted draft)

> **AI-assisted draft. The team must edit it before submission.** Written with Claude (Anthropic) on
> 21–22 Nov 2026 and declared in the report's Appendix A. Each member must read, run and be able to
> explain their own service before submitting it.

26CSCN29H Cloud Computing and Cloud Security. Owners: Buckets & Budgets: **Saged Ehab (244694)** ·
Transactions: **Salma Amir** · Insights & Reports: **Omar Mohamed** · Auth: shared.

Lab 7 architecture extended to four services: S3 website → API Gateway (HTTP API) → 4 Lambda
functions (Express + `serverless-http`) → DynamoDB, S3, SNS, Secrets Manager, CloudWatch, plus the
open.er-api.com exchange-rate API.

**Team workflow:** see [CONTRIBUTING.md](CONTRIBUTING.md): who owns which files, branches and pull requests, and the plan to the deadline.

## Layout

| Folder | Content |
|---|---|
| `services/auth-service` | register, login (scrypt, lockout after 5 failures), profile, admin user list/disable |
| `services/buckets-service` | **Saged**: buckets, effective limit, rollover, hard limit, transfers, SNS alerts, archive, templates; `check-spend` / `evaluate` for Transactions |
| `services/transactions-service` | **Salma Amir**: income/expenses, filters, currency conversion, summaries, receipts (S3 pre-signed URLs) |
| `services/insights-service` | **Omar Mohamed**: dashboard, trends, CSV reports (S3), admin overview |
| `packages/pb-common` | shared: JWT auth middleware, Secrets Manager loader, validator, redacting JSON logger + EMF metrics, DynamoDB store, service-to-service client |
| `frontend/` | HTML/CSS/JS app (auth, dashboard, buckets, transactions, reports, admin), CSP, no innerHTML |
| `infra/` | `deploy-floci.sh`, `check-floci.sh`, `destroy-floci.sh`, `monitoring/`, `iam/` (one least-privilege policy per Lambda), `floci/docker-compose.yml`, local gateway and frontend server |
| `tests/` | unit, integration, security and Lambda-handler tests (node:test) |
| `evidence/` | results written by the tests, plus local UI screenshots |

## Run locally (no Docker needed)

```bash
npm run sync                  # copy packages/pb-common into each service (after editing it)
npm run dev                   # API on http://localhost:3000, app on http://localhost:8080
npm test && npm run evidence  # 39 checks -> evidence/test-results.md
```
Each service needs `npm install` once (already done on this PC). `npm run dev` uses `.env` if it
exists (copy `.env.example`); otherwise it creates a temporary secret and keeps data in memory.
To get a local admin, set `DEV_ADMIN_EMAIL` and `DEV_ADMIN_PASSWORD` in your shell before `npm run dev`.

## Status (22 Nov 2026)

| Item | State |
|---|---|
| Four services + frontend working together locally | **done**, checked in a browser |
| Automated tests | **39/39 pass locally**; see `evidence/test-results.md` |
| Floci deployment (`infra/*.sh`, IAM policies) | **written, never run**. Docker and the AWS CLI were not installed. Follow `docs/FLOCI-DEPLOY-CHECKLIST.md` |
| Floci / CloudWatch / IAM screenshots | **not taken**. See the checklist, Part D |
| Lambda Invoke between services | tested in-process (LT-02); **not yet on Floci** |

Known points to watch on the first Floci run: `ANY /{proxy+}` route support, the `nodejs24.x` runtime
name, the S3 lifecycle rule, and the metric-filter/alarm commands. The script prints a note when any
of these is not supported. Record what happened, as a limitation or a fix.

## Security notes

- No secrets in the repository. `.env` is git-ignored, and the JWT key lives in Secrets Manager on Floci.
- Not-owned items return 404 (ownership comes from the token's user id in the partition key). Admin routes return 403 for normal users.
- Logs never contain request bodies, passwords or tokens (checked by test ST-14).
- A disabled account is blocked even while its token is still valid. Every service checks the account status and current role with the Auth service: the answer is reused for at most 60 s, and admin routes always check again (Phase 1 proposal threat 6; test ST-15).
