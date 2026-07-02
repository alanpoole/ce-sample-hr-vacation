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
  region        = var.region
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

# Allow Unauthenticated public traffic for the Frontend UI only
resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  service  = google_cloud_run_v2_service.frontend_service.name
  location = google_cloud_run_v2_service.frontend_service.location
  role     = "roles/run.viewer"
  member   = "allUsers"
}
