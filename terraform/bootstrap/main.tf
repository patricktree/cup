terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  backend "gcs" {
    bucket = "cup-infrastructure-646301813623-tfstate"
    prefix = "bootstrap"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

provider "google" {
  project = "cup-infrastructure"
}

resource "google_project" "infrastructure" {
  name            = "cup-infrastructure"
  project_id      = "cup-infrastructure"
  billing_account = "01EF28-40C66E-325909"
  deletion_policy = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket" "terraform_state" {
  project                     = google_project.infrastructure.project_id
  name                        = "cup-infrastructure-646301813623-tfstate"
  location                    = "EUROPE-WEST3"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  lifecycle {
    prevent_destroy = true
  }
}
