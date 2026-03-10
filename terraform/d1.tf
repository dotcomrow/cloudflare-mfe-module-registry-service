data "cloudflare_d1_databases" "registry_preview_lookup" {
  count      = var.manage_d1_resources ? 0 : 1
  account_id = var.cloudflare_account_id
  name       = var.d1_dev_registry_name
  max_items  = 2
}

data "cloudflare_d1_databases" "registry_production_lookup" {
  count      = var.manage_d1_resources ? 0 : 1
  account_id = var.cloudflare_account_id
  name       = var.d1_prod_registry_name
  max_items  = 2
}

resource "cloudflare_d1_database" "registry_preview" {
  count      = var.manage_d1_resources ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = var.d1_dev_registry_name
  read_replication = {
    mode = var.d1_dev_read_replication_mode
  }
}

resource "cloudflare_d1_database" "registry_production" {
  count      = var.manage_d1_resources ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = var.d1_prod_registry_name
  read_replication = {
    mode = var.d1_prod_read_replication_mode
  }
}

locals {
  d1_registry_preview_id      = var.manage_d1_resources ? cloudflare_d1_database.registry_preview[0].id : one(data.cloudflare_d1_databases.registry_preview_lookup[0].result).id
  d1_registry_preview_name    = var.manage_d1_resources ? cloudflare_d1_database.registry_preview[0].name : one(data.cloudflare_d1_databases.registry_preview_lookup[0].result).name
  d1_registry_production_id   = var.manage_d1_resources ? cloudflare_d1_database.registry_production[0].id : one(data.cloudflare_d1_databases.registry_production_lookup[0].result).id
  d1_registry_production_name = var.manage_d1_resources ? cloudflare_d1_database.registry_production[0].name : one(data.cloudflare_d1_databases.registry_production_lookup[0].result).name
  active_registry_database_id = local.is_preview_deployment ? local.d1_registry_preview_id : local.d1_registry_production_id
}

moved {
  from = cloudflare_d1_database.registry_preview
  to   = cloudflare_d1_database.registry_preview[0]
}

moved {
  from = cloudflare_d1_database.registry_production
  to   = cloudflare_d1_database.registry_production[0]
}
