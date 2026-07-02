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

By default, the application is deployed as a **secure single-region service** inside `us-central1`. To fulfill the organizational security policies:
1. Ingress to the Cloud Run service is locked to load balancing only.
2. An **External HTTP/HTTPS Application Load Balancer (GCLB)** and **Identity-Aware Proxy (IAP)** are configured by default to authenticate employees before they can access the frontend portal.

---

## 📐 Infrastructure as Code (IaC)

A complete **Terraform** module is provided under the `terraform/` directory. This module outlines how to provision the baseline secure topology:

```hcl
cd terraform
terraform init
terraform plan
```

This IaC module sets up the private VPC subnetwork, Serverless VPC Access connector, Private Service Connection peering, an isolated PostgreSQL instance, Native Firestore, and the **Global Load Balancer with Identity-Aware Proxy (IAP) enabled by default**, exposing access to the student's email (defined via `var.student_email`).

---

## 🎓 Coursework: Upgrading to Multi-Region Load Balancing

To support low-latency global transactions for subsidiaries in Europe and Asia, students must upgrade the baseline single-region configuration into a **highly available, multi-regional topology**. 

Follow these step-by-step instructions to update your application code and IaC templates to be multi-regional:

### Step 1: Declare a Second Regional Cloud Run Frontend
In `terraform/main.tf`, declare a new regional Cloud Run frontend service in a second region (e.g., `europe-west1`):
```hcl
resource "google_cloud_run_v2_service" "frontend_europe" {
  name     = "hr-vacation-frontend-europe"
  location = "europe-west1"
  ingress  = "INGRESS_TRAFFIC_INTERNAL_AND_CLOUD_LOAD_BALANCING"

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app_repo.repository_id}/frontend:latest"
      ports {
        container_port = 8080
      }
      env {
        name  = "BACKEND_API_URL"
        value = google_cloud_run_v2_service.backend_service.uri
      }
    }
  }
}
```

### Step 2: Create a European Serverless NEG
Define a regional serverless Network Endpoint Group (NEG) targeting the new European Cloud Run frontend:
```hcl
resource "google_compute_region_network_endpoint_group" "serverless_neg_europe" {
  name                  = "hr-vacation-neg-europe"
  network_endpoint_type = "SERVERLESS"
  region                = "europe-west1"
  cloud_run {
    service = google_cloud_run_v2_service.frontend_europe.name
  }
}
```

### Step 3: Register Both Regional NEGs to the IAP Backend Service
Update the existing backend service (`google_compute_backend_service.backend_service`) to route traffic to both the US and Europe NEGs. GCLB will automatically direct clients to the nearest region using Anycast IP routing:
```hcl
resource "google_compute_backend_service" "backend_service" {
  name                  = "hr-vacation-backend-service"
  protocol              = "HTTP"
  port_name             = "http"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  # Primary US Backend
  backend {
    group = google_compute_region_network_endpoint_group.serverless_neg.id
  }

  # Failover / Latency-Optimized Europe Backend
  backend {
    group = google_compute_region_network_endpoint_group.serverless_neg_europe.id
  }

  iap {
    oauth2_client_id     = var.iap_client_id
    oauth2_client_secret = var.iap_client_secret
  }
}
```

### Step 4: Configure Cross-Region SQL Replication
To ensure European users experience low-latency read operations, set up a regional Cloud SQL read replica in `europe-west1`:
```hcl
resource "google_sql_database_instance" "replica_europe" {
  name                 = "hr-vacation-sql-db-replica"
  region               = "europe-west1"
  database_version     = "POSTGRES_15"
  master_instance_name = google_sql_database_instance.postgres.name

  settings {
    tier = "db-f1-micro"
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc_network.id
    }
  }
}
```

### Step 5: Verify the Multi-Regional Setup
1. Apply the updated Terraform configuration (`terraform apply`).
2. Verify that GCLB forwards traffic to both `us-central1` and `europe-west1` based on user location.
3. Access the portal and inspect the simulated terminal logs. Confirm that Central IAP identity verification remains unified across all entry nodes while requests are routed locally!

