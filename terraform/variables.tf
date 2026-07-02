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
