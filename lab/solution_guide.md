# Advanced Agentic Skills Hands-on Labs — Cheat Sheet / Solution Guide
**Module 1 · Phase 2 — Break-Fix Challenge & Multi-Region Resiliency**  
**Reference Application:** CE Sample HR Vacation (`https://github.com/deyvidm18/ce-sample-hr-vacation`)  
**Target Audience:** Google Cloud Customer Engineers (CEs), Cloud Architects, and Platform Engineers

---

## Executive Summary & Scenario Overview

Following the Phase 1 modernization of Cymbal Group's **HR Vacation Request Subsystem** from a single-region deployment into a multi-region architecture (`us-central1` primary, `europe-west1` secondary) fronted by a Global External Application Load Balancer (GCLB) and backed by **AlloyDB for PostgreSQL**, the development team shipped a **v2.0 release** that introduced two systemic faults.

Immediately after the v2.0 deployment, operations reported:
1. **Severe European Latency:** European users accessing the portal experience p95 latencies exceeding 800 ms during routine page loads and database queries.
2. **Intermittent Service Crashes (HTTP 500):** During simulated quarterly-review peak traffic, the Node.js backend Cloud Run service throws intermittent HTTP 500 errors and drops requests.

> [!IMPORTANT]
> **Production Guardrail:** This is a restricted production environment — **no manual Cloud Console access is permitted**. All investigation, diagnosis, infrastructure remediation, application refactoring, and progressive rollout validation must be executed strictly through agentic AI tooling (**VS Code Antigravity Plugin**, **Antigravity 2.0**, and **Antigravity CLI**) powered by the **Gemini Cloud Assist remote MCP server**.

---

## The Two Planted Faults (Answer Key Summary)

| Fault | Category | Root Cause Location | Symptom | Remediation Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Fault 1** | **Infrastructure & Regional Routing** | `europe-west1` Cloud Run revision (`hr-vacation-app-europe`) environment variables (`DB_READ_HOST`) | European read requests cross the Atlantic to `write-db.hr-vacation.internal` (`us-central1`) instead of using the local European secondary replica (`read-db.hr-vacation.internal`). | Imperatively update the Cloud Run service environment variable (`DB_READ_HOST=read-db.hr-vacation.internal`) using `gcloud run services update` to route local reads through Cloud DNS. |
| **Fault 2** | **Application Code (Connection Leak)** | Node.js REST API handlers in `server.js` (`/api/state`, `/api/requests`, `/api/requests/:id/action`) | New database client pool (`new Pool()`) instantiated inside route handlers per HTTP request and never released, rapidly exhausting database connection limits (`HTTP 500`). | Refactor `server.js` to initialize a single, long-lived, shared connection pool at application startup outside route handlers and reuse it across all requests. |

---

## Task-by-Task Solution Walkthrough

### Task 1: Investigate & Triage the Outage (Read-Only)
Before making any mutations, leverage agentic observability tools via MCP to localize both faults.

1. **Query Telemetry via Gemini Cloud Assist MCP:**
   - Query Cloud Logging across both `hr-vacation-app` (`us-central1`) and `hr-vacation-app-europe` (`europe-west1`) over the past 60 minutes.
   - Extract the top error signatures. Observe repeated PostgreSQL/AlloyDB connection rejection errors (`FATAL: remaining connection slots are reserved for non-replication superuser connections` or `too many clients already`).
2. **Localize Latency via Cloud Trace:**
   - Inspect Cloud Trace spans for `hr-vacation-app-europe`.
   - Confirm that downstream database queries originating from `europe-west1` show high network propagation delays across region boundaries (targeting `us-central1` instead of local `europe-west1` endpoints).
3. **Inspect Environment Variables:**
   - Read the revision metadata for `hr-vacation-app-europe` and verify that `DB_READ_HOST` is wrongly set to `write-db.hr-vacation.internal` (US primary) instead of `read-db.hr-vacation.internal` (European read replica).
4. **Produce Triage Summary:**
   - Instruct the agent to generate `docs/incident-triage.md` linking concrete log entries and trace span IDs to the two suspected root causes.

---

### Task 2: Resolve the Infrastructure Fault (Regional Routing)
Correct the misinjected environment variable on the European Cloud Run service imperatively.

1. **Verify Current Configuration:**
   - Confirm `DB_READ_HOST` versus the expected DNS endpoint defined in `terraform/main.tf`.
2. **Apply Imperative Fix:**
   - Use the Antigravity CLI (`gcloud run services update`) to set `DB_READ_HOST=read-db.hr-vacation.internal` on `hr-vacation-app-europe` in `europe-west1`.
3. **Verify Routing:**
   - Re-run Cloud Trace sampling and confirm that read queries in `europe-west1` now resolve locally with sub-50 ms latency.

---

### Task 3: Resolve the Application Fault (Connection Leak)
Refactor the Node.js backend (`server.js`) to establish a global database connection pool.

1. **Locate the Leak in `server.js`:**
   - Open `server.js` in the Antigravity IDE. Locate where the database driver connection (`new Pool(...)` or `new Client(...)`) is instantiated directly inside the `/api/requests` and `/api/state` request handlers without cleanup.
2. **Refactor to a Global Pool:**
   - Hoist connection pool initialization outside route handlers to application startup.
   - Attach robust `error` event listeners to prevent unhandled socket disconnects from crashing the process.
3. **Local Verification:**
   - Run `npm test` (`server.test.js`) locally to verify that all 11 API suites pass cleanly and connection counts remain bounded.

---

### Task 4: Deploy the Hotfix
Build the patched container image and deploy it across both regions with zero downtime.

1. **Build Container Image:**
   - Submit the build to Cloud Build: `gcloud builds submit --tag us-central1-docker.pkg.dev/$PROJECT_ID/ce-sample-hr-vacation-repo/app:v2.0.1 .`
2. **Deploy to Both Regions:**
   - Update `hr-vacation-app` (`us-central1`) and `hr-vacation-app-europe` (`europe-west1`) to use image tag `:v2.0.1` while preserving `DB_WRITE_HOST`, `DB_READ_HOST`, `DB_PASS`, and the Serverless VPC Access Connector (`hr-vpc-connector`).

---

### Task 5: Validate System Recovery
Confirm that both faults are resolved under sustained traffic load.

1. **Simulate Regional Traffic Load:**
   - Generate concurrent API requests targeting the global Anycast load balancer IP from simulated US and European clients.
2. **Verify Recovery Targets:**
   - **European Latency:** Confirm p95 latency is `< 50 ms`.
   - **Error Rate:** Confirm `HTTP 500` error rate is `0.00%`.
   - **AlloyDB Connections:** Confirm `alloydb.googleapis.com/database/postgresql/num_connections` metric stabilizes and remains flat under sustained QPS.

---

## Appendix A — Root-Cause Answer Key (Instructor Reference)

### Fault 1: Regional Routing Misconfiguration
- **Location:** Cloud Run service `hr-vacation-app-europe` (`europe-west1`) environment variable `DB_READ_HOST`.
- **Symptom:** High `europe-west1` read latency (~800+ ms); Cloud Trace spans show cross-region hops.
- **Remediation Command:**
  ```bash
  gcloud run services update hr-vacation-app-europe \
      --region=europe-west1 \
      --update-env-vars=DB_READ_HOST=read-db.hr-vacation.internal,DB_WRITE_HOST=write-db.hr-vacation.internal
  ```

### Fault 2: Database Connection Leak in `server.js`
- **Location:** `server.js` route handlers (`/api/state`, `/api/requests`, `/api/requests/:id/action`).
- **Symptom:** Intermittent `HTTP 500 Internal Server Error` (`AlloyDB connection pool limit exceeded: 4 active unclosed connections`); connection slots exhausted under modest concurrency.
- **Code Comparison:**

#### Before (Buggy Code — Per-Request `new Pool()` Instantiation)
```javascript
const express = require('express');
const { Pool } = require('pg');
const app = express();

app.get('/api/state', async (req, res) => {
  // BUG: Instantiates a new Pool inside the request handler on EVERY request!
  const config = getDbConfig(false);
  const pool = new Pool(config);
  const client = await pool.connect();
  
  try {
    const data = await client.query('SELECT * FROM workflows');
    res.json({ workflows: data.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    // BUG: client.release() and pool.end() are OMITTED!
    // -> Every API request leaks the database connection socket until HTTP 500 crash!
  }
});
```

#### After (Patched Code — Global Shared Pool at Startup)
```javascript
const express = require('express');
const { Pool } = require('pg');
const app = express();

// 1. Create ONE shared PostgreSQL connection pool at startup outside route handlers
const pool = new Pool(getDbConfig(false));

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client pool', err);
});

app.get('/api/state', async (req, res) => {
  // 2. Re-use the shared, long-lived pool to acquire clients
  const client = await pool.connect();
  try {
    const data = await client.query('SELECT * FROM workflows');
    res.json({ workflows: data.rows });
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: 'Database query failed' });
  } finally {
    // 3. ALWAYS release the database client back to the global pool in a finally block
    client.release();
  }
});
```

---

## Appendix B — Validation Checklist (Scoring Aid)

- [ ] **Strict Agentic Tooling Compliance:** All actions executed through IDE plugin, Antigravity 2.0, or CLI with Gemini Cloud Assist MCP; zero manual Google Cloud Console edits.
- [ ] **Comprehensive Triage Document:** `docs/incident-triage.md` generated, naming both suspected root causes with corresponding Cloud Logging and Cloud Trace evidence links.
- [ ] **Routing Remediation Verified:** `hr-vacation-app-europe` environment variable `DB_READ_HOST` updated to `read-db.hr-vacation.internal`; Cloud Trace proves local read routing.
- [ ] **Connection Pool Refactored:** Per-request database driver instantiations removed from `server.js`; a single shared `Pool` initialized at application startup with error handling.
- [ ] **Multi-Region Hotfix Deployed:** Patched image (`:v2.0.1`) built and deployed to both `us-central1` (`hr-vacation-app`) and `europe-west1` (`hr-vacation-app-europe`).
- [ ] **Target SLAs Achieved:** European user p95 latency `< 50 ms`; `HTTP 500` error rate holds at `0.00%` under 3-minute load test; AlloyDB connection counts remain flat.

---

## Appendix C — Exact Agent Prompts (Step-by-Step Playbook)

Copy and paste each prompt exactly in order into the **Antigravity Agent Panel (IDE)** or the **Antigravity CLI**. Ensure your workspace is opened to the `ce-sample-hr-vacation` repository root before starting.

### One-Time Setup Constants
```env
PROJECT_ID=<YOUR_LAB_PROJECT_ID>
PRIMARY_REGION=us-central1
SECONDARY_REGION=europe-west1
APP_SERVICE_US=hr-vacation-app
APP_SERVICE_EU=hr-vacation-app-europe
ALLOYDB_CLUSTER=hr-vacation-cluster-primary
ALLOYDB_INSTANCE=hr-vacation-primary-instance
IMAGE_TAG=us-central1-docker.pkg.dev/<YOUR_LAB_PROJECT_ID>/ce-sample-hr-vacation-repo/app:v2.0.1
```

---

### Task 1 — Investigate & Triage the Outage (Read-Only)

#### Prompt 1.1a — Pull Error Logs via Gemini Cloud Assist MCP
```text
Using Antigravity 2.0 with the Gemini Cloud Assist remote MCP server, query Cloud Logging in project <YOUR_LAB_PROJECT_ID> over the last 60 minutes for Cloud Run services hr-vacation-app (us-central1) and hr-vacation-app-europe (europe-west1). Return the top error signatures, total counts, and full stack traces for any HTTP 500 errors. Also report any database connection errors from AlloyDB/PostgreSQL. Read-only — do not make any changes yet.
```

#### Prompt 1.1b — Analyze Latency via Cloud Trace
```text
Query Cloud Trace for requests handled by hr-vacation-app-europe in europe-west1 over the last 60 minutes. Break down the span latency of a representative slow request and identify the downstream database hostname, IP, and region targeted by the read queries. Tell me explicitly whether hr-vacation-app-europe is reading from a local europe-west1 endpoint or crossing regions to us-central1.
```

#### Prompt 1.1c — Inspect Suspect Environment Variables (Read-Only)
```text
Describe the current active revisions of Cloud Run services hr-vacation-app (us-central1) and hr-vacation-app-europe (europe-west1). List all database-related environment variables (DB_WRITE_HOST, DB_READ_HOST, DB_PASS) along with their exact values and the VPC connector configured. Confirm whether DB_READ_HOST on the European service points to the local read endpoint or the US primary write endpoint. Read-only.
```

#### Prompt 1.1d — Write the Triage Document (Artifact)
```text
Write a markdown incident triage document to docs/incident-triage.md detailing the two root causes identified during our investigation: (1) Regional routing misconfiguration on hr-vacation-app-europe where DB_READ_HOST is pointed to write-db.hr-vacation.internal (us-central1) instead of local read-db.hr-vacation.internal, and (2) Database connection exhaustion caused by per-request connection instantiation in server.js. Include log evidence, trace latency breakdowns, and our planned remediation. Render it as an Artifact.
```

---

### Task 2 — Resolve the Infrastructure Fault (Regional Routing)

#### Prompt 2.1 — Confirm Expected vs. Actual DNS Endpoints
```text
Review the private DNS managed zone hr-vacation-private-zone configured in terraform/main.tf. Confirm the expected DNS hostnames for write and read operations (`write-db.hr-vacation.internal` and `read-db.hr-vacation.internal`). Show me the side-by-side comparison of what hr-vacation-app-europe currently uses in its environment variables versus what it should use.
```

#### Prompt 2.2 — Imperatively Correct Environment Variables & Redeploy
```text
Using the Antigravity CLI / gcloud run services update, update the Cloud Run service hr-vacation-app-europe in region europe-west1 so that environment variable DB_READ_HOST is set to read-db.hr-vacation.internal and DB_WRITE_HOST is set to write-db.hr-vacation.internal. Ensure the VPC access connector configuration is preserved. Deploy a new revision and return the revision name.
```

#### Prompt 2.3 — Verify Local Routing Recovery
```text
Re-run our Cloud Trace sampling for hr-vacation-app-europe over the newly deployed revision. Confirm that database read spans now target the local read-db.hr-vacation.internal endpoint and report the new p50 and p95 downstream latency compared to our pre-fix baseline.
```

---

### Task 3 — Resolve the Application Fault (Connection Leak)

#### Prompt 3.1 — Locate Connection Leak in `server.js`
```text
Open server.js in our workspace. Find all instances where database connection pools, clients, or drivers are instantiated or initialized. Identify which instantiations occur inside Express route handlers (/api/requests, /api/state, etc.). Explain how per-request instantiation without explicit closure leads to connection pool exhaustion under high concurrency.
```

#### Prompt 3.2 — Refactor to Global Connection Pool
```text
Refactor server.js so that a single shared PostgreSQL/AlloyDB connection pool is initialized once at top-level application startup using process.env.DB_WRITE_HOST/DB_READ_HOST and process.env.DB_PASS. Attach an 'error' event handler to the pool to catch idle connection drops. Update all route handlers (/api/requests, /api/state, /api/requests/:id/action) to acquire clients from this shared pool using `await pool.connect()`, execute their transactions, and ensure `client.release()` is called in a `finally` block. Show me the exact diff.
```

#### Prompt 3.3 — Execute Local Unit & Integration Verification
```text
Run the local test suite using `npm test` (`server.test.js`) to verify that all 11 unit and API integration tests pass with our refactored global connection pool. Confirm that database state resets cleanly and no connection leaks are reported during execution.
```

---

### Task 4 — Deploy the Hotfix

#### Prompt 4.1 — Build and Push Patched Image
```text
Using the Antigravity CLI / gcloud builds submit, build the refactored container image from our workspace root and push it to Artifact Registry at us-central1-docker.pkg.dev/<YOUR_LAB_PROJECT_ID>/ce-sample-hr-vacation-repo/app:v2.0.1. Return the final image digest upon completion.
```

#### Prompt 4.2 — Deploy Patched Revision to Both Regions
```text
Deploy the new container image us-central1-docker.pkg.dev/<YOUR_LAB_PROJECT_ID>/ce-sample-hr-vacation-repo/app:v2.0.1 imperatively to BOTH hr-vacation-app (us-central1) and hr-vacation-app-europe (europe-west1). Preserve all database environment variables (DB_WRITE_HOST, DB_READ_HOST, DB_PASS) and the VPC access connector on both services. Return the new revision IDs and service URLs.
```

#### Prompt 4.3 — Progressive Rollout (Optional)
```text
Optionally shift 10% of incoming traffic to the new revision v2.0.1 on both hr-vacation-app and hr-vacation-app-europe using `gcloud run services update-traffic`. Monitor Cloud Logging for 2 minutes for any HTTP 500 errors. If the error rate holds at 0%, promote the traffic split to 100% on the new revisions.
```

---

### Task 5 — Validate System Recovery

#### Prompt 5.1 — Simulate Regional Traffic Load
```text
Using agentic tools or curl benchmark scripts, simulate sustained quarterly-review traffic against the Global External Application Load Balancer Anycast IP from both simulated US and European client profiles for 3 minutes at 50 requests/sec. Report the total requests served and distribution by region.
```

#### Prompt 5.2 — Confirm European p95 Latency `< 50 ms`
```text
Query Cloud Trace and Cloud Monitoring for the 3-minute load test window. Report the p50, p90, and p95 latency for requests served by hr-vacation-app-europe. Confirm that p95 latency is below the 50 ms target threshold.
```

#### Prompt 5.3 — Confirm `0.00%` Error Rate & Flat Connections
```text
Query Cloud Monitoring via MCP for the metric `alloydb.googleapis.com/database/postgresql/num_connections` across our AlloyDB cluster, and check Cloud Logging for any HTTP 5xx responses from either Cloud Run service. Confirm that connection counts remained stable/flat under load and the error rate is exactly 0%.
```

#### Prompt 5.4 — Generate Final Recovery Report (Artifact)
```text
Write a comprehensive recovery report to docs/recovery-report.md summarizing our root-cause investigation, the infrastructure regional routing correction, the application connection pool refactoring, and our post-deployment metrics comparison (before vs. after latency, HTTP 500 rate, and AlloyDB connection counts). Render it as an Artifact ready for final evaluation and scoring.
```

---

## Appendix D — Extension: Solving the Built-in Classroom Challenges

For Customer Engineers conducting deep-dives on the repository's native interactive laboratory challenges (`public/index.html`), use these prompts and solutions to demonstrate architectural expansion:

### Challenge 1: Scale Reads Locally with AlloyDB Read Pool
**Objective:** Add a high-performance stateless Read Pool instance in `us-central1` using Terraform (`main.tf`) to scale local read queries with zero data copy latency.
**Agent Prompt:**
```text
Inspect terraform/main.tf and add a new google_alloydb_instance resource named `read_pool` with instance_id `hr-vacation-read-pool`, instance_type `READ_POOL`, 1 node in read_pool_config, and 2 vCPUs in machine_config attached to google_alloydb_cluster.primary. Run `terraform validate` and explain how read pools share storage with the primary instance.
```

### Challenge 2: Multi-Region Load Balancing & Anycast Routing
**Objective:** Add a secondary Cloud Run service (`hr-vacation-app-europe`) and Serverless NEG in `europe-west1`, attaching both regional NEGs to the global backend service in `terraform/main.tf`.
**Agent Prompt:**
```text
Review terraform/main.tf and add (1) a google_cloud_run_v2_service for `hr-vacation-app-europe` in `europe-west1`, (2) a `google_compute_region_network_endpoint_group` named `serverless_neg_europe` in `europe-west1`, and (3) update `google_compute_backend_service.backend_service` to include both the US and European serverless NEGs in its backend blocks. Run `terraform validate`.
```

### Challenge 3: AlloyDB Disaster Recovery & Regional Failover
**Objective:** Execute a zero-code-change cross-region failover when `us-central1` experiences a catastrophic outage by promoting the European secondary cluster and updating Cloud DNS.
**Agent Prompt:**
```text
Execute the cross-region disaster recovery runbook: (1) Promote the secondary AlloyDB cluster in europe-west1 to standalone primary read-write mode using `gcloud alloydb clusters promote-secondary hr-vacation-cluster-eu --region=europe-west1`, and (2) execute a Cloud DNS transaction on zone `hr-vacation-private-zone` to update the A record for `write-db.hr-vacation.internal.` to point to the newly promoted European cluster IP address. Confirm zero redeployments are required for Cloud Run backends.
```
