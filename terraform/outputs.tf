output "d1_registry_preview_name" {
  value       = local.d1_registry_preview_name
  description = "Preview D1 registry database name."
}

output "d1_registry_preview_id" {
  value       = local.d1_registry_preview_id
  description = "Preview D1 registry database UUID."
}

output "d1_registry_production_name" {
  value       = local.d1_registry_production_name
  description = "Production D1 registry database name."
}

output "d1_registry_production_id" {
  value       = local.d1_registry_production_id
  description = "Production D1 registry database UUID."
}

output "active_deployment_environment" {
  value       = local.deployment_environment
  description = "Active deployment environment for this workspace run."
}

output "active_worker_service" {
  value       = local.active_worker_service_name
  description = "Worker service name targeted by this workspace run."
}

output "worker_version_id" {
  value       = cloudflare_worker_version.app.id
  description = "Latest Worker version uploaded by Terraform."
}

output "worker_production_hostname" {
  value       = try(cloudflare_workers_custom_domain.app_production[0].hostname, "")
  description = "Production custom domain hostname mapped to the Worker service."
}

output "worker_preview_hostname" {
  value       = try(cloudflare_workers_custom_domain.app_preview[0].hostname, "")
  description = "Preview custom domain hostname mapped to the Worker service."
}

output "worker_production_route_pattern" {
  value       = try(cloudflare_workers_route.app_production[0].pattern, "")
  description = "Production Worker route pattern managed by Terraform."
}

output "worker_preview_route_pattern" {
  value       = try(cloudflare_workers_route.app_preview[0].pattern, "")
  description = "Preview Worker route pattern managed by Terraform."
}
