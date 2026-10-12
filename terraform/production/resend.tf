provider "resend" {}

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
