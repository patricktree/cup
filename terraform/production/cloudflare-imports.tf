# Adoption of existing Cloudflare resources. After the first apply these blocks are no-ops; delete this
# file then.

import {
  to = cloudflare_r2_bucket.audio
  id = "a7648178b6a63bb8a13f0c9de89d253f/create-audiobook-from-url-audio/default"
}

import {
  to = cloudflare_dns_record.cup_audio_resend_return_path
  id = "c8e20cc4a39dd016799943a156ea9470/401791331170910c6fdfb4f6b34037a8"
}

import {
  to = cloudflare_dns_record.cup_audio_resend_send
  id = "c8e20cc4a39dd016799943a156ea9470/851bd45850307ea3ed7a45873734eed7"
}

import {
  to = cloudflare_dns_record.cup_audio_null_mx
  id = "c8e20cc4a39dd016799943a156ea9470/31ae5a901e0a20db2fad9488b1d99f0b"
}

import {
  to = cloudflare_dns_record.cup_audio_spf
  id = "c8e20cc4a39dd016799943a156ea9470/f79c0e275f8c8ed45cb4cfca8cd97995"
}

import {
  to = cloudflare_dns_record.cup_audio_dmarc
  id = "c8e20cc4a39dd016799943a156ea9470/aff4ff502435fe81470283f51ac4d511"
}

import {
  to = cloudflare_dns_record.cup_audio_resend_dkim
  id = "c8e20cc4a39dd016799943a156ea9470/f99fcc72463a6052315ba0ca9d146510"
}

import {
  to = cloudflare_dns_record.cup_audio_com_null_mx
  id = "8a1d2447e703110aa6ecd2bf4c61bc30/26c5396f82d07a00b3a41b779621ee22"
}

import {
  to = cloudflare_dns_record.cup_audio_com_spf
  id = "8a1d2447e703110aa6ecd2bf4c61bc30/6a9f73853faa24e6f9205f7969f681c3"
}

import {
  to = cloudflare_dns_record.cup_audio_com_dmarc
  id = "8a1d2447e703110aa6ecd2bf4c61bc30/b86b321536017cc68e6dfafabddef777"
}

import {
  to = cloudflare_zero_trust_access_policy.allow_operator
  id = "a7648178b6a63bb8a13f0c9de89d253f/93cf61a5-b329-439e-9195-f0cfdb8a327e"
}

import {
  to = cloudflare_zero_trust_access_application.operator_api
  id = "accounts/a7648178b6a63bb8a13f0c9de89d253f/03cb3ac7-c250-44fa-8460-7844fd936226"
}
