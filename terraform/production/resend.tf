provider "resend" {}

# Created in the Resend dashboard on 2026-10-12; remove this block after the import is applied.
import {
  to = resend_domain.cup_audio
  id = "c9699e52-23e4-4fa7-a86c-b1a21f3e0d16"
}

resource "resend_domain" "cup_audio" {
  name           = "cup.audio"
  region         = "eu-west-1"
  open_tracking  = false
  click_tracking = false
  tls            = "opportunistic"

  lifecycle {
    prevent_destroy = true
  }
}

# Former sending domain; remove after the deployed Worker sends from cup.audio.
resource "resend_domain" "production" {
  name           = "cup-audio.com"
  region         = "eu-west-1"
  open_tracking  = false
  click_tracking = false
  tls            = "opportunistic"

  lifecycle {
    prevent_destroy = true
  }
}
