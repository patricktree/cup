terraform {
  required_version = ">= 1.10.0, < 2.0.0"

  backend "gcs" {
    bucket = "cup-infrastructure-646301813623-tfstate"
    prefix = "production"
  }

  required_providers {
    resend = {
      source  = "y0n0zawa/resend"
      version = "1.0.1"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "1.11.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

provider "google" {
  project = "cup-production"
}

resource "google_project" "production" {
  name            = "cup-production"
  project_id      = "cup-production"
  deletion_policy = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }
}
