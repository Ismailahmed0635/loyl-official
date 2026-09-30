terraform {
  required_providers {
    google = { source = "hashicorp/google", version = ">= 5.0" }
  }
}

variable "project_id" {
  type        = string
  description = "GCP project id, e.g. loyl-df23d"
}

locals {
  # SECRET names only. NEXT_PUBLIC_* keys are public by design and stay out.
  secrets = toset([
    "DATABASE_URL",
    "JWT_SECRET",
    "ADMIN_PASSWORD",
    "OPENAI_API_KEY",
    "CLOUDINARY_API_SECRET",
    "AWS_SECRET_ACCESS_KEY",
    "FIREBASE_PRIVATE_KEY",
  ])
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secrets
  project   = var.project_id
  secret_id = each.key
  replication {
    auto {}
  }
}

# Data-access audit logging: who read/wrote which secret, when.
resource "google_project_iam_audit_config" "secretmanager_audit" {
  project = var.project_id
  service = "secretmanager.googleapis.com"
  audit_log_config { log_type = "DATA_READ" }
  audit_log_config { log_type = "DATA_WRITE" }
  audit_log_config { log_type = "ADMIN_READ" }
}
