# Module 1 - Phase 2: Diagnosing & Remediating Multi-Region Cloud Infrastructure Outages
## Lab Scoping & Requirements Document

### Overview
- **Lab type:** Challenge Lab / Break-fix lab
- **Intended learner profile:** Candidate for Platform CE / Outcome CE

### Lab Summary
This lab tests the learner's ability to operate under pressure by actively diagnosing, troubleshooting, and repairing cloud infrastructure failures in a live, intentionally broken environment. Following the successful modernization of the single-region infrastructure, the development team has deployed a new version of the HR application to the multi-region environment. However, this deployment has introduced systemic faults causing severe performance degradation.

Learners will utilize advanced AI tooling—specifically the VS Code IDE Antigravity Plugin, Antigravity 2.0, Antigravity CLI, and Google Agent Skills via the Model Context Protocol (MCP)—to read observability logs, pinpoint the application bottlenecks, and apply debugging and bugfixing strategies without manual console access.

Learners must uncover and resolve two distinct, critical issues:
1. **Infrastructure/Configuration Level:** A regional routing misconfiguration forcing cross-region latency (European frontend mistakenly routed to the US database).
2. **Application Code Level:** A severe connection leak causing cascading database failures (initializing database client pools inside request handlers, exhausting the AlloyDB connection limits).

### Learning Objectives
In this lab, you learn how to perform the following tasks:
- Diagnose production faults using Agentic AI tools to parse and interpret Google Cloud observability logs (Cloud Logging).
- Identify application-level configuration bugs affecting cross-region replication and connections in a multi-region AlloyDB database architecture.
- Remediate broken Node.js backend code and deploy hotfixes imperatively using the VS Code Antigravity IDE and gcloud/CLI commands.
- Validate service recovery by running simulated health checks against the load-balanced endpoints.

---

### Challenge Scenario: Infrastructure Troubleshooting for Cymbal Group HR Subsystem
You are a Platform Cloud Engineer consulting for the Enterprise Architecture division at Cymbal Group. Following your successful migration of the Vacation Request Subsystem from a vulnerable single-region footprint into a highly available, multi-region architecture, the Cymbal Group development team pushed a new code release (v2.0).

This new release was intended to integrate with the newly provisioned AlloyDB cluster and dynamically route database read/write requests. However, immediately after deployment, the environment became unstable. During the simulated peak quarterly review cycles, users are experiencing massive latency, and the backend Cloud Run service is throwing intermittent 500 Internal Server Errors.

You have been paged to resolve this outage. Because this is a restricted production environment, you do not have manual access to the Google Cloud Console. You must leverage your agentic IDEs, Google Agent Skills, and the Model Context Protocol (MCP) to read the observability logs, diagnose the code logic or infrastructure misconfiguration, and deploy a fix to restore the application's availability.

---

### High-Level Task List

#### 1. Investigate and Triage the Outage
- **Action:** Query Cloud Logging. Analyze the Cloud Run request logs and database error traces.
- **Goal:** Identify why the `europe-west1` frontend is taking excessively long to respond (>800ms) and isolate the stack traces generating the HTTP 500 errors (`ERR_DB_CONNECTION_EXHAUSTED`) in the backend service.

#### 2. Resolve the Infrastructure Fault (Regional Routing)
- **Action:** Update the Cloud Run environment variables.
- **Goal:** Discover that the v2.0 deployment script injected the wrong `DB_READ_HOST` environment variable into the `europe-west1` frontend service, forcing cross-region transatlantic reads to the US primary database instead of the local European read replica. Update the variable to the correct local replica endpoint.

#### 3. Resolve the Application Fault (Connection Leak)
- **Action:** Refactor the database connection pool instantiation in `server.js`.
- **Goal:** Discover that v2.0 introduced a PostgreSQL client leak: `new Pool()` is being initialized inside the route handlers for every single HTTP request, rather than globally at application startup. This rapidly exhausts the AlloyDB connection limits. Refactor the code to use a global connection pool singleton.

#### 4. Deploy the Hotfix
- **Action:** Rebuild the container image and redeploy the service.
- **Goal:** Rebuild the patched image and redeploy the Cloud Run service, prompting it to create a new active revision and route 100% of traffic.

#### 5. Validate System Recovery
- **Action:** Run load verification queries.
- **Goal:** Confirm that European latency drops below the 50ms SLA and that the backend service maintains a 0% error rate under sustained review cycles.
