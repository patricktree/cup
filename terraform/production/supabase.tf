provider "supabase" {}

variable "supabase_database_password" {
  type      = string
  sensitive = true
}

variable "google_web_client_id" {
  type = string

  validation {
    condition     = endswith(var.google_web_client_id, ".apps.googleusercontent.com")
    error_message = "Provide the Google Web application OAuth client ID."
  }
}

variable "google_web_client_secret" {
  type      = string
  sensitive = true

  validation {
    condition     = length(trimspace(var.google_web_client_secret)) > 0
    error_message = "Provide the Google Web application OAuth client secret."
  }
}

resource "supabase_project" "production" {
  organization_id   = "tgncgsivqksoldkhbsyf"
  name              = "cup-production"
  region            = "eu-west-1"
  database_password = var.supabase_database_password

  lifecycle {
    prevent_destroy = true
  }
}

resource "supabase_settings" "production" {
  project_ref = supabase_project.production.id
  auth = jsonencode({
    site_url                         = "https://cup-audio.com/app"
    uri_allow_list                   = "http://127.0.0.1:5174/web.html"
    jwt_exp                          = 300
    external_google_enabled          = true
    external_google_client_id        = var.google_web_client_id
    external_google_secret           = var.google_web_client_secret
    external_google_skip_nonce_check = false
  })
}

output "supabase_project_ref" {
  value = supabase_project.production.id
}

output "supabase_url" {
  value = "https://${supabase_project.production.id}.supabase.co"
}
