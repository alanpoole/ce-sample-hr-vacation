variable "project_id" {
  description = "The Google Cloud Platform project ID to deploy into."
  type        = string
  default     = "our-metric-501215-n6"
}

variable "region" {
  description = "The target deployment region for single-region isolation."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "The primary zone for Cloud SQL."
  type        = string
  default     = "us-central1-a"
}

variable "iap_client_id" {
  description = "The OAuth Client ID for Identity-Aware Proxy."
  type        = string
  default     = ""
  sensitive   = true
}

variable "iap_client_secret" {
  description = "The OAuth Client Secret for Identity-Aware Proxy."
  type        = string
  default     = ""
  sensitive   = true
}

