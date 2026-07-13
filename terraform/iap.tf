# Retrieve project info
data "google_project" "project" {}

# Create IAP OAuth Brand (OAuth consent screen)
resource "google_iap_brand" "project_brand" {
  support_email     = var.support_email
  application_title = "Cymbal HR Portal"
  project           = data.google_project.project.project_id
}

# Create IAP OAuth Client
resource "google_iap_client" "project_client" {
  display_name = "IAP Client"
  brand        = google_iap_brand.project_brand.name
}

# Provision IAP Service Identity (Service Agent Account)
resource "google_project_service_identity" "iap_sa" {
  provider = google-beta
  project  = data.google_project.project.project_id
  service  = "iap.googleapis.com"
}

# Grant IAP service account access to invoke the Cloud Run service
resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
  name     = google_cloud_run_v2_service.app_service.name
  location = google_cloud_run_v2_service.app_service.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_project_service_identity.iap_sa.email}"
}

# Grant the user access to use the IAP secured portal
resource "google_iap_web_backend_service_iam_member" "user_accessor" {
  web_backend_service = google_compute_backend_service.backend_service.name
  role                = "roles/iap.httpsResourceAccessor"
  member              = "user:${var.iap_user}"
}
