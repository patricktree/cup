# The Resend domain cup.audio is no longer managed by Terraform. This block forgets it from state on
# the next apply without deleting it in Resend; delete this file after that apply.
removed {
  from = resend_domain.cup_audio

  lifecycle {
    destroy = false
  }
}
