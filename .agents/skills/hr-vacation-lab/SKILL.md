---
name: hr-vacation-lab
description: >-
  Diagnoses and repairs infrastructure regional routing and application connection leaks for the CE Sample HR Vacation subsystem (`ce-sample-hr-vacation`), including Cloud Run, AlloyDB for PostgreSQL, Cloud DNS, and GCLB. Use when triaging latency or HTTP 500 errors in hr-vacation-app or hr-vacation-app-europe, fixing database endpoint environment variables (`DB_READ_HOST`, `DB_WRITE_HOST`), refactoring Node.js database connection pools in `server.js`, deploying multi-region Cloud Run revisions, or executing AlloyDB disaster recovery failovers (`promote-secondary`, Cloud DNS record updates). Don't use for generic Google Cloud operations unrelated to the HR Vacation lab or for non-AlloyDB/PostgreSQL databases.
---

# HR Vacation Lab Agent Skill (`hr-vacation-lab`)

## Domain Architecture Context

The CE Sample HR Vacation subsystem is an enterprise time-off scheduling and accrual tracking portal running across Google Cloud:
- **Compute:** Node.js monolithic application (`server.js`) deployed as serverless containers on **Cloud Run** across `us-central1` (`hr-vacation-app`) and `europe-west1` (`hr-vacation-app-europe`).
- **Database:** **AlloyDB for PostgreSQL** multi-region cluster (`hr-vacation-cluster-primary`) with primary read-write instances in `us-central1` and read replicas/secondary clusters in `europe-west1`.
- **Private DNS:** Zero-code-change database abstraction via **Cloud DNS** private zone (`hr-vacation.internal`):
  - `write-db.hr-vacation.internal` $\rightarrow$ Resolves to AlloyDB Primary Read-Write instance (`us-central1`).
  - `read-db.hr-vacation.internal` $\rightarrow$ Resolves to local regional Read Pool or Secondary replica (`europe-west1`).
- **Networking:** Serverless VPC Access Connector (`hr-vpc-connector`) routing private egress to AlloyDB. Global External Application Load Balancer (GCLB) with Anycast routing fronting both regional Serverless NEGs.

---

## Observability & Triage Protocol (Task 1)

When paged for high latency or HTTP 500 errors in `ce-sample-hr-vacation`, **ALWAYS perform strictly read-only triage first** before making any modifications.

### 1. Query Error Signatures via Gemini Cloud Assist MCP
Use the `Gemini Cloud Assist` remote MCP server to query Cloud Logging across both regions:
```text
resource.type="cloud_run_revision"
(resource.labels.service_name="hr-vacation-app" OR resource.labels.service_name="hr-vacation-app-europe")
severity>=ERROR
```
**Gotcha Check:** Look for repeated PostgreSQL client errors such as `remaining connection slots are reserved for non-replication superuser connections` or `too many clients already`. This confirms an application-tier database connection leak.

### 2. Check Regional Span Propagation via Cloud Trace
Inspect trace spans for `hr-vacation-app-europe` (`europe-west1`).
**Gotcha Check:** If downstream database spans show durations $> 100\text{ ms}$ and target `us-central1` IP addresses instead of local European endpoints, the European Cloud Run service is misconfigured to route queries across the Atlantic.

### 3. Inspect Service Environment Variables
Check the active revision configuration of `hr-vacation-app-europe`:
```bash
gcloud run services describe hr-vacation-app-europe --region=europe-west1 --format="yaml(spec.template.spec.containers[0].env)"
```
**Gotcha Check:** Confirm that `DB_READ_HOST` is set to `read-db.hr-vacation.internal` and NOT hardcoded to `write-db.hr-vacation.internal` or the US primary IP.

---

## Infrastructure Remediation Pattern (Task 2)

If `DB_READ_HOST` on `hr-vacation-app-europe` points to the US primary (`write-db.hr-vacation.internal`), correct it imperatively:

```bash
gcloud run services update hr-vacation-app-europe \
    --region=europe-west1 \
    --update-env-vars=DB_READ_HOST=read-db.hr-vacation.internal,DB_WRITE_HOST=write-db.hr-vacation.internal
```

**Why:** By setting `DB_READ_HOST` to the private DNS read hostname (`read-db.hr-vacation.internal`), European requests stay within `europe-west1` and hit the local read replica/pool, dropping latency from ~800 ms down to $< 50\text{ ms}$.

---

## Application Refactoring Pattern: Global Connection Pool (Task 3)

### The Anti-Pattern (Connection Leak in `server.js`)
Do **NOT** instantiate database drivers (`Pool` or `Client`) or Redis clients (`redis.createClient()`) inside HTTP route handlers (`/api/requests`, `/api/state`, etc.):
```javascript
// ❌ WRONG: Creates a new TCP connection on every HTTP request and leaks it!
app.get('/api/state', async (req, res) => {
  const redisClient = redis.createClient({ url: process.env.REDIS_ADDR });
  await redisClient.connect();
  
  const pool = new Pool({ host: process.env.DB_WRITE_HOST, ... });
  const client = await pool.connect();
  // ...
  // BUG: redisClient.quit() and client.release() / pool.end() are OMITTED -> sockets leak!
});
```

### The Canonical Refactoring Pattern
Hoist the `Pool` and `redisClient` initialization to top-level application startup (`server.js`), attach `error` listeners, and acquire/release clients properly:

```javascript
// ✅ CORRECT: Single global connection pool created once at startup outside handlers
const redis = require('redis');
const { Pool } = require('pg');

// 1. Redis Global Pool
const redisClient = redis.createClient({ url: process.env.REDIS_ADDR || 'redis://localhost:6379' });
redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.connect().catch(err => console.error('Redis startup error:', err));

// 2. PostgreSQL Global Pool
const pool = new Pool({
  host: process.env.DB_WRITE_HOST || 'write-db.hr-vacation.internal',
  user: 'postgres',
  password: process.env.DB_PASS,
  database: 'hr_vacation',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client pool', err);
});

app.get('/api/state', async (req, res) => {
  // Re-use shared redisClient across all requests
  const client = await pool.connect();
  try {
    const data = await client.query('SELECT * FROM workflows');
    res.json({ workflows: data.rows });
  } catch (err) {
    res.status(500).json({ error: 'Query failed' });
  } finally {
    // MANDATORY: Always release database client back to pool
    client.release();
  }
});
```

**Verification:** Always run `npm test` (`server.test.js`) locally after editing `server.js` to ensure all unit/integration test suites pass before deploying.

---

## Multi-Region Hotfix Deployment (Task 4)

1. **Submit Build:**
   ```bash
   gcloud builds submit --tag us-central1-docker.pkg.dev/$PROJECT_ID/ce-sample-hr-vacation-repo/app:v2.0.1 .
   ```
2. **Deploy to Both Regions:**
   ```bash
   # Primary Region (us-central1)
   gcloud run services deploy hr-vacation-app \
       --image=us-central1-docker.pkg.dev/$PROJECT_ID/ce-sample-hr-vacation-repo/app:v2.0.1 \
       --region=us-central1

   # Secondary Region (europe-west1)
   gcloud run services deploy hr-vacation-app-europe \
       --image=us-central1-docker.pkg.dev/$PROJECT_ID/ce-sample-hr-vacation-repo/app:v2.0.1 \
       --region=europe-west1
   ```

---

## Classroom Challenge & DR Runbook Cheatsheet

When guiding students through the interactive lab cards (`public/index.html`):

- **Challenge 1 (`READ_POOL`):** Add `google_alloydb_instance` with `instance_type = "READ_POOL"` in `terraform/main.tf` attached to `google_alloydb_cluster.primary`.
- **Challenge 2 (Multi-Region NEG):** Add `google_compute_region_network_endpoint_group.serverless_neg_europe` (`SERVERLESS` type in `europe-west1`) and register both NEGs inside `google_compute_backend_service.backend_service`.
- **Challenge 3 (DR Failover):**
  1. Promote secondary cluster:
     ```bash
     gcloud alloydb clusters promote-secondary hr-vacation-cluster-eu --region=europe-west1
     ```
  2. Update Cloud DNS A-record (`write-db.hr-vacation.internal.`) in zone `hr-vacation-private-zone` using `gcloud dns record-sets transaction` commands so backends reconnect seamlessly without code changes.
