# How the three of us work at the same time

Team 04: Saged Ehab, Salma Amir, Omar Mohamed. **Deadline: Wed 25 Nov 2026, 23:59** (Moodle).

The code started as an **AI-assisted draft**, declared in the report's Appendix A. Each of us must
read, run and be able to explain our own service, and should improve it in our own commits.

## 1. Who owns which files

Stay in your own lane. Most merge conflicts come from two people editing the same file.

| Person | Owns | Takes their own Floci screenshots of |
|---|---|---|
| **Saged** | `services/buckets-service/`, `frontend/js/buckets.js`, `infra/` | buckets, near-limit alert, hard limit, transfers, IAM, deploy output |
| **Salma** | `services/transactions-service/`, `frontend/js/transactions.js` | transactions, USD → EGP conversion, filters, receipts |
| **Omar** | `services/insights-service/`, `frontend/js/insights.js`, `frontend/js/admin.js` | dashboard, CSV reports, CloudWatch alarms |

**Shared files.** Each has one owner. Tell that owner before you change it.

| Shared file / folder | Owner |
|---|---|
| `packages/pb-common/` (auth middleware, validation, logging, store) | Saged |
| `services/auth-service/` | Omar |
| `frontend/index.html`, `frontend/css/style.css`, `frontend/js/main.js`, `ui.js`, `api.js` | Salma |
| `tests/`: add your own tests in your own `describe`/test IDs | everyone |

After changing `packages/pb-common/`, run `npm run sync` so each service gets the new copy.

## 2. First time (each person)

```bash
git clone https://github.com/SagedEhab/personal-budget-buckets.git
cd personal-budget-buckets
for s in services/*-service; do (cd "$s" && npm install); done
npm run dev          # http://localhost:8080 (API on :3000), no Docker needed
npm test             # should show 39 passed
```

## 3. Every working session: commit on your own branch

Course rule (announcement, Nov 2026): **one public team repository, and each member has a branch of
their own for their commits**. The branches are `saged`, `salma` and `omar`. Work only on yours.

```bash
git switch salma                             # your own branch (first time: git switch -c salma origin/salma)
git pull                                     # get your latest work
git merge origin/main                        # bring in what the others have merged
# ... edit only your files ...
npm test                                     # must stay green
git add -A && git commit -m "Transactions: clearer error when FX API is down"
git push
```

When a piece of work is finished, open a **pull request from your branch into `main`** on GitHub.
Another member reviews it, and the `security-checks` workflow runs the tests, the dependency scan
and the secret scan. Merge it when the checks are green. Keep your branch afterwards: its commits
and pull requests are shown at the discussion.

- Commit **from your own GitHub account**. The commit history is the evidence of your individual work.
- Each member also needs a **separate personal repository** for proof of individual work (it does
  not have to be a working project), for example your own service, your tests and your notes.
- Make small, frequent pull requests, not one big one at the end.
- Never commit `.env`, passwords, tokens or AWS keys (`.gitignore` already excludes `.env`).

## 4. Floci: everyone runs their own

Floci is a local AWS emulator, so each laptop has its own copy. There is no shared server to fight
over. Follow `docs/FLOCI-DEPLOY-CHECKLIST.md` (or the steps in the report): install Docker and the AWS
CLI, then `bash infra/deploy-floci.sh` and `bash infra/check-floci.sh`. Screenshot **your own**
service for your contribution statement. The final demo and video run on one laptop (Saged's).

## 5. The report: edit online, not in git

Word files cannot be merged. Keep `Team04-Final-Report` on OneDrive or Google Drive and edit it together:

- each person writes their own section 3.x, their own **Individual Contribution Statement** (first person, real evidence only) and their own row in Appendix A ("What the team did");
- replace the red `[INSERT SCREENSHOT / REAL RESULT]` boxes with real Floci screenshots;
- Saged does the final read-through and removes the red "AI-assisted draft" lines last.

## 6. Plan to the deadline

| When | Saged | Salma | Omar |
|---|---|---|---|
| **Tue 24 Nov** | Repo set up (done); Floci installed and deployed, 11/11 checks (done) | Install Docker, AWS CLI, Floci; clone; run and read Transactions | Same, for Insights and Auth |
| **Wed 25 morning** | Buckets screenshots, IAM, deploy output; report §2, §6, §8 | Transactions screenshots; §3.2, §5 | Insights + CloudWatch screenshots; §3.3, §11 |
| **Wed 25 afternoon** | Personal proof-of-work repo; merge all PRs; record the ≤5-min video; final report check | Personal repo; contribution statement | Personal repo; contribution statement |
| **Wed 25, before 23:59** | Submit on Moodle together | | |

Open questions for the team are in the report's "Changes since the Phase 1 proposal" section
(alerts moved from Insights to Buckets; security logs read in CloudWatch).
