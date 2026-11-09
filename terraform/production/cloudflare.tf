# Reads CLOUDFLARE_API_TOKEN from the environment; see terraform/README.md for its permissions.
provider "cloudflare" {}

locals {
  cloudflare_account_id = "a7648178b6a63bb8a13f0c9de89d253f"
}

import {
  to = cloudflare_r2_bucket.audio
  id = "${local.cloudflare_account_id}/create-audiobook-from-url-audio/default"
}

# The Worker's AUDIO_BUCKET binding; holds every listener's narration audio.
resource "cloudflare_r2_bucket" "audio" {
  account_id    = local.cloudflare_account_id
  name          = "create-audiobook-from-url-audio"
  jurisdiction  = "default"
  location      = "eeur"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}
