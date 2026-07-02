# HR Vacation Request Subsystem - Interactive Classroom Simulator

Welcome to the **Vacation Request Subsystem** lab application! This repository contains a fully containerized, interactive web simulator designed for students and system architects to learn about Google Cloud Platform (GCP) private network designs, relational vs. NoSQL transaction patterns, and high-availability mitigation strategies.

---

## 📖 Scenario Overview

The Vacation Request Subsystem handles scheduling and accrued balance logic for international subsidiaries across the **Retail, Healthcare, and Financial Services** sectors. 

Currently, the application runs as a **single-region** service isolated inside a private Google Cloud Virtual Private Cloud (VPC) network. All services communicate internally, securely shielded from public internet exposure.

### Core Google Cloud Services Used:
1. **Cloud Run (Frontend)**: Serves the containerized UI for employees and managers to submit/review time-off requests.
2. **Cloud Run (Backend)**: Drives business rules engines, validations, and routes transactional states.
3. **Cloud SQL**: Relational database managing strongly consistent employee records, department structures, and accrued vacation totals.
4. **Firestore (Native)**: Highly scalable NoSQL document store capturing asynchronous workflow states (`/workflows`) and live notification events (`/notifications`).
5. **Virtual Private Cloud (VPC)**: The private networking boundary. Utilizes **Serverless VPC Access connectors** and **Private Service Connect / Private Service Networking** to isolate the database and serverless runtimes inside internal networks.

---

## 🧪 Simulation Features

This application embeds a beautiful **Diagnostics & Sim playground** that lets you learn interactively:
* **Role Swap Selector**: Take on roles ranging from a sales associate in the US to clinical directors in the UK and VP of Compliance in Japan. Swapping roles updates your profile context, department boundaries, and accrual balances.
* **Animated Network Topology**: Submitting a request triggers a live, animated traffic trace across a Google Cloud architecture diagram. Watch the packet route from the **Frontend** to the **Backend API**, through the private VPC gateway, down to the relational **Cloud SQL** (relational database queries) and NoSQL **Firestore** collections in real time.
* **Real-Time DB Inspectors**:
  * **Mock SQL Console**: Watch relational tables (`employees`, `accrual_balances`, `departments`) change as you submit requests or approve them.
  * **Mock Firestore Document Tree**: Inspect NoSQL JSON payloads inside key-value document databases.
* **Interactive Rules Validation Engine**: Experience industry-grade regulatory limits:
  * **Retail Blackouts**: Restricts requests during holiday shopping rushes (Nov 15 - Jan 5) without VP escalation.
  * **Healthcare On-Call Coverage**: Restricts time off if more than 30% of a department's staff are off concurrently (ensuring 70%+ patient safety coverage).
  * **Financial Quarter Close Constraints**: Blocks scheduling requests during the final 5 business days of fiscal quarters for SOX/audit regulations. Enforces block-leave policies of at least 10 consecutive business days.

---

## 🛠️ Getting Started Locally

You can spin up this application locally using standard Node.js or Docker.

### Running with Node.js:
1. Ensure you have Node.js 18+ installed.
2. Initialize dependencies:
   ```bash
   npm install
   ```
3. Boot the server:
   ```bash
   npm start
   ```
4. Access the portal in your browser at `http://localhost:8080`.

### Running with Docker:
1. Build the local image:
   ```bash
   docker build -t hr-vacation-app .
   ```
2. Run the container on port 8080:
   ```bash
   docker run -p 8080:8080 hr-vacation-app
   ```

---

## ☁️ Deploying to Google Cloud

The project includes an automation script (`deploy.sh`) to build and host this service on your own GCP environment.

To deploy the application to your active GCP project, run the following:
```bash
chmod +x deploy.sh
./deploy.sh
```

The script will automatically:
1. Enable the required GCP service APIs (`run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`).
2. Create an Artifact Registry Docker repository named `ce-sample-hr-vacation-repo`.
3. Submit the codebase to Cloud Build to compile your container.
4. Deploy the service to a managed Cloud Run instance and print the public link.

---

## 📐 Infrastructure as Code (IaC)

A complete **Terraform** module is provided under the `terraform/` directory. This module outlines how to provision the actual private infrastructure topology:

```hcl
# Read, review, or execute:
cd terraform
terraform init
terraform plan
```

This IaC module sets up the private VPC subnetwork, Serverless VPC Access connector, Private Service Connection peering, an isolated PostgreSQL instance with private IP, a Native Firestore instance, and Cloud Run services mapped to the VPC connector.

---

## 🎓 Student Laboratory Exercises

Open the **Student Labs** tab inside the web portal to review details for three architect-level lab challenges:

### 🔬 Exercise 1: Relational Multi-Region SQL Replication
* **Task**: Transition Cloud SQL from single-region to high availability with cross-region read replicas.
* **Architecture**: Create an active master in `us-central1` and a regional replica in `europe-west1` via Terraform.

### 🔬 Exercise 2: Anycast Global Load Balancing
* **Task**: Bridge international latency for European or Asian employees using a Global HTTPS Load Balancer.
* **Architecture**: Configure serverless NEGs (Network Endpoint Groups) routing frontend requests to regional Cloud Run instances automatically based on geographic proximity.

### 🔬 Exercise 3: Syncing Firestore Multi-Region Active-Active Data
* **Task**: Evaluate replication lag and conflict resolution models when migrating a Firestore database to European dual-region storage `eur3`.
