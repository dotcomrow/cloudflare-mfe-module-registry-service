locals {
  domain_trimmed = trimspace(var.domain)
  app_hostname   = local.domain_trimmed != "" ? "${var.project_name}.${local.domain_trimmed}" : ""

  worker_service_name_production = trimspace(var.worker_service_name_production) != "" ? trimspace(var.worker_service_name_production) : var.project_name
  worker_service_name_preview    = trimspace(var.worker_service_name_preview) != "" ? trimspace(var.worker_service_name_preview) : "${var.project_name}-preview"
  preview_hostname               = trimspace(var.worker_preview_hostname) != "" ? trimspace(var.worker_preview_hostname) : (local.domain_trimmed != "" ? "${local.worker_service_name_preview}.${local.domain_trimmed}" : "")

  deployment_environment = lower(trimspace(var.deployment_environment))
  is_preview_deployment  = local.deployment_environment == "preview"

  active_worker_service_name = local.is_preview_deployment ? local.worker_service_name_preview : local.worker_service_name_production
  active_runtime_environment = local.is_preview_deployment ? var.environment_name_preview : var.environment_name_production
  google_auth_allowed_audiences_effective = trimspace(var.google_auth_allowed_audience) != "" ? trimspace(var.google_auth_allowed_audience) : trimspace(var.google_auth_allowed_audiences)

  app_route_pattern = trimspace(var.worker_production_route_pattern) != "" ? trimspace(var.worker_production_route_pattern) : (
    trimspace(var.worker_domain_environment_production) != "" ? trimspace(var.worker_domain_environment_production) : (
      local.app_hostname != "" ? "${local.app_hostname}/*" : ""
    )
  )

  preview_route_pattern = trimspace(var.worker_preview_route_pattern) != "" ? trimspace(var.worker_preview_route_pattern) : (
    trimspace(var.worker_domain_environment_preview) != "" ? trimspace(var.worker_domain_environment_preview) : (
      local.preview_hostname != "" ? "${local.preview_hostname}/*" : ""
    )
  )
}

resource "cloudflare_workers_custom_domain" "app_production" {
  count = var.manage_worker_domains && !local.is_preview_deployment ? 1 : 0

  account_id = var.cloudflare_account_id
  zone_id    = var.cloudflare_zone_id
  hostname   = local.app_hostname
  service    = cloudflare_worker.app.name

  depends_on = [cloudflare_workers_deployment.app]

  lifecycle {
    precondition {
      condition     = trimspace(var.cloudflare_zone_id) != ""
      error_message = "cloudflare_zone_id is required when manage_worker_domains=true."
    }
    precondition {
      condition     = local.app_hostname != ""
      error_message = "domain (or explicit worker hostname) is required when managing production custom domain."
    }
  }
}

resource "cloudflare_workers_custom_domain" "app_preview" {
  count = var.manage_worker_domains && local.is_preview_deployment ? 1 : 0

  account_id = var.cloudflare_account_id
  zone_id    = var.cloudflare_zone_id
  hostname   = local.preview_hostname
  service    = cloudflare_worker.app.name

  depends_on = [cloudflare_workers_deployment.app]

  lifecycle {
    precondition {
      condition     = trimspace(var.cloudflare_zone_id) != ""
      error_message = "cloudflare_zone_id is required when manage_worker_domains=true."
    }
    precondition {
      condition     = local.preview_hostname != ""
      error_message = "domain (or explicit worker_preview_hostname) is required when managing preview custom domain."
    }
  }
}

resource "cloudflare_workers_route" "app_production" {
  count = var.manage_worker_routes && !local.is_preview_deployment ? 1 : 0

  zone_id = var.cloudflare_zone_id
  pattern = local.app_route_pattern
  script  = cloudflare_worker.app.name

  depends_on = [cloudflare_workers_deployment.app]

  lifecycle {
    precondition {
      condition     = trimspace(var.cloudflare_zone_id) != ""
      error_message = "cloudflare_zone_id is required when manage_worker_routes=true."
    }
    precondition {
      condition     = local.app_route_pattern != ""
      error_message = "A production route pattern is required when manage_worker_routes=true."
    }
  }
}

resource "cloudflare_workers_route" "app_preview" {
  count = var.manage_worker_routes && local.is_preview_deployment ? 1 : 0

  zone_id = var.cloudflare_zone_id
  pattern = local.preview_route_pattern
  script  = cloudflare_worker.app.name

  depends_on = [cloudflare_workers_deployment.app]

  lifecycle {
    precondition {
      condition     = trimspace(var.cloudflare_zone_id) != ""
      error_message = "cloudflare_zone_id is required when manage_worker_routes=true."
    }
    precondition {
      condition     = local.preview_route_pattern != ""
      error_message = "A preview route pattern is required when manage_worker_routes=true."
    }
  }
}
