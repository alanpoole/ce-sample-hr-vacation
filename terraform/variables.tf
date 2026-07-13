variable "project_id" {
  description = "The Google Cloud Platform project ID to deploy into."
  type        = string
}

variable "region" {
  description = "The target deployment region for single-region isolation."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "The primary zone for AlloyDB."
  type        = string
  default     = "us-central1-a"
}

variable "support_email" {
  description = "The support email address for the OAuth Consent Screen (IAP brand)."
  type        = string
}

variable "iap_user" {
  description = "The email address of the user allowed to access the application via IAP."
  type        = string
}
