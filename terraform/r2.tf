resource "cloudflare_r2_bucket" "assets_preview" {
  count      = var.manage_r2_resources ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = var.r2_dev_assets_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "assets_production" {
  count      = var.manage_r2_resources ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = var.r2_prod_assets_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  r2_assets_bucket_preview_name    = var.manage_r2_resources ? cloudflare_r2_bucket.assets_preview[0].name : var.r2_dev_assets_bucket_name
  r2_assets_bucket_production_name = var.manage_r2_resources ? cloudflare_r2_bucket.assets_production[0].name : var.r2_prod_assets_bucket_name
  active_r2_assets_bucket_name     = local.is_preview_deployment ? local.r2_assets_bucket_preview_name : local.r2_assets_bucket_production_name

  active_publish_uploads_public_base_url = local.is_preview_deployment
    ? trimspace(var.publish_uploads_public_base_url_preview)
    : trimspace(var.publish_uploads_public_base_url_production)
}

moved {
  from = cloudflare_r2_bucket.assets_preview
  to   = cloudflare_r2_bucket.assets_preview[0]
}

moved {
  from = cloudflare_r2_bucket.assets_production
  to   = cloudflare_r2_bucket.assets_production[0]
}
