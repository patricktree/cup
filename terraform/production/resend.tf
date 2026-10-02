provider "resend" {}

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
