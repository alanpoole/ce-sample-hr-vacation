terraform {
  required_version = ">= 1.3.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# -------------------------------------------------------------
# 1. FOUNDATIONAL VIRTUAL PRIVATE CLOUD (VPC)
# -------------------------------------------------------------

resource "google_compute_network" "vpc_network" {
  name                    = "hr-vacation-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet_regional" {
  name          = "hr-vacation-subnet-us"
  ip_cidr_range = "10.0.1.0/24"
  network       = google_compute_network.vpc_network.id
  region        = var.region
}

# Serverless VPC Access Connector
resource "google_vpc_access_connector" "vpc_connector" {
  name          = "hr-vpc-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.vpc_network.name
}

# Private Service Networking (For Private Cloud SQL communication)
resource "google_compute_global_address" "private_ip_alloc" {
  name          = "private-ip-alloc-sql"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc_network.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.vpc_network.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_alloc.name]
}

# -------------------------------------------------------------
# 2. PRIMARY RELATION RELATIONAL STORE (Cloud SQL Postgres)
# -------------------------------------------------------------

resource "google_sql_database_instance" "postgres" {
  name             = "hr-vacation-sql-db"
  region           = var.region
  database_version = "POSTGRES_15"

  depends_on = [google_service_networking_connection.private_vpc_connection]

  settings {
    tier = "db-f1-micro" # Lightweight development tier
    
    ip_configuration {
      ipv4_enabled    = false # Isolate fully from public internet
      private_network = google_compute_network.vpc_network.id
    }

    # Backup configurations required for replication / Point-in-time recoveries
    backup_configuration {
      enabled    = true
      start_time = "02:00"
    }
  }
}

resource "google_sql_database" "hr_database" {
  name     = "hr_vacation"
  instance = google_sql_database_instance.postgres.name
}

# -------------------------------------------------------------
# 3. ASYNCHRONOUS WORKFLOW DOCUMENT STORE (Firestore)
# -------------------------------------------------------------

resource "google_firestore_database" "firestore" {
  name        = "(default)"
  location_id = "nam5" # US Multi-region
  type        = "FIRESTORE_NATIVE"
}

# -------------------------------------------------------------
# 4. ARTIFACT REGISTRY & COMPUTE LAYER (Cloud Run Services)
# -------------------------------------------------------------

resource "google_artifact_registry_repository" "app_repo" {
  repository_id = "ce-sample-hr-vacation-repo"
  format        = "DOCKER"
}

# Cloud Run (Backend Service)
resource "google_cloud_run_v2_service" "backend_service" {
  name     = "hr-vacation-backend"
  location = var.region

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app_repo.repository_id}/backend:latest"
      ports {
        container_port = 8080
      }
      env {
        name  = "DB_HOST"
        value = google_sql_database_instance.postgres.private_ip_address
      }
    }
    
    # Enforce routing outbound backend traffic through Serverless VPC Connector
    vpc_access {
      connector = google_vpc_access_connector.vpc_connector.id
      egress    = "ALL_TRAFFIC"
    }
  }
}

# Cloud Run (Frontend Service)
resource "google_cloud_run_v2_service" "frontend_service" {
  name     = "hr-vacation-frontend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

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

# Allow IAM invocation for GCLB / Authenticated proxy requests
resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  name     = google_cloud_run_v2_service.frontend_service.name
  location = google_cloud_run_v2_service.frontend_service.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# -------------------------------------------------------------
# 5. GLOBAL EXTERNAL LOAD BALANCER (GCLB) WITH IAP
# -------------------------------------------------------------

# Serverless NEG (Network Endpoint Group) targeting the Cloud Run Frontend
resource "google_compute_region_network_endpoint_group" "serverless_neg" {
  name                  = "hr-vacation-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  cloud_run {
    service = google_cloud_run_v2_service.frontend_service.name
  }
}

# Backend Service for GCLB with IAP enabled
resource "google_compute_backend_service" "backend_service" {
  name                  = "hr-vacation-backend-service"
  protocol              = "HTTP"
  port_name             = "http"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.serverless_neg.id
  }

  iap {
    oauth2_client_id     = var.iap_client_id
    oauth2_client_secret = var.iap_client_secret
  }
}

# Global URL Map mapping GCLB incoming paths to the serverless backend
resource "google_compute_url_map" "url_map" {
  name            = "hr-vacation-url-map"
  default_service = google_compute_backend_service.backend_service.id
}

# Target HTTP Proxy for plaintext dev validation
resource "google_compute_target_http_proxy" "http_proxy" {
  name    = "hr-vacation-http-proxy"
  url_map = google_compute_url_map.url_map.id
}

# Global HTTP Forwarding Rule
resource "google_compute_global_forwarding_rule" "http_forwarding_rule" {
  name                  = "hr-vacation-http-forwarding-rule"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_proxy.id
}

# Cryptographic resources for Load Balancer SSL Termination
resource "tls_private_key" "key" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_self_signed_cert" "cert" {
  private_key_pem = tls_private_key.key.private_key_pem

  subject {
    common_name  = "hr-vacation.gcp-lab.internal"
    organization = "Google Cloud Lab Classroom"
  }

  validity_period_hours = 8760 # 1 year

  allowed_uses = [
    "key_encipherment",
    "digital_signature",
    "server_auth",
  ]
}

resource "google_compute_ssl_certificate" "self_signed" {
  name        = "hr-vacation-self-signed-cert"
  private_key = tls_private_key.key.private_key_pem
  certificate = tls_self_signed_cert.cert.cert_pem
}

# Target HTTPS Proxy for SSL termination at GCLB
resource "google_compute_target_https_proxy" "https_proxy" {
  name             = "hr-vacation-https-proxy"
  url_map          = google_compute_url_map.url_map.id
  ssl_certificates = [google_compute_ssl_certificate.self_signed.id]
}

# Global HTTPS Forwarding Rule
resource "google_compute_global_forwarding_rule" "https_forwarding_rule" {
  name                  = "hr-vacation-https-forwarding-rule"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.https_proxy.id
}

# Grant default Identity-Aware Proxy (IAP) access to the student
resource "google_iap_web_backend_service_iam_member" "student_access" {
  project             = var.project_id
  web_backend_service = google_compute_backend_service.backend_service.name
  role                = "roles/iap.httpsResourceAccessor"
  member              = "user:${var.student_email}"
}


