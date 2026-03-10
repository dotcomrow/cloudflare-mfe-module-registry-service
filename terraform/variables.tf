variable "cloudflare_token" {
  type        = string
  description = "Cloudflare API token used by Terraform provider."
  sensitive   = true
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account identifier."
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare DNS zone identifier (required only when managing domains/routes)."
  default     = ""
}

variable "project_name" {
  type        = string
  description = "Project/service name used for default Worker and hostname values."
  default     = "cloudflare-mfe-module-registry-service"
}

variable "org_name" {
  type        = string
  description = "Organization name for informational use."
  default     = ""
}

variable "deployment_environment" {
  type        = string
  description = "Workspace deployment environment selector: production or preview."
  default     = "production"

  validation {
    condition     = contains(["production", "preview"], lower(trimspace(var.deployment_environment)))
    error_message = "deployment_environment must be either 'production' or 'preview'."
  }
}

variable "manage_d1_resources" {
  type        = bool
  description = "When true, Terraform creates D1 databases; when false it only looks up existing database IDs."
  default     = true
}

variable "d1_dev_registry_name" {
  type        = string
  description = "Preview D1 database name."
  default     = "mfe-module-registry-dev"
}

variable "d1_prod_registry_name" {
  type        = string
  description = "Production D1 database name."
  default     = "mfe-module-registry-prod"
}

variable "d1_dev_read_replication_mode" {
  type        = string
  description = "Preview D1 read replication mode."
  default     = "auto"
}

variable "d1_prod_read_replication_mode" {
  type        = string
  description = "Production D1 read replication mode."
  default     = "auto"
}

variable "worker_service_name_production" {
  type        = string
  description = "Optional Worker service name override for production."
  default     = ""
}

variable "worker_service_name_preview" {
  type        = string
  description = "Optional Worker service name override for preview."
  default     = ""
}

variable "domain" {
  type        = string
  description = "Base DNS domain used for Worker custom domain defaults (for example example.com)."
  default     = ""
}

variable "worker_preview_hostname" {
  type        = string
  description = "Optional preview hostname override. Defaults to <worker_service_name_preview>.<domain>."
  default     = ""
}

variable "manage_worker_domains" {
  type        = bool
  description = "When true, Terraform manages Workers custom domain mappings."
  default     = false
}

variable "manage_worker_routes" {
  type        = bool
  description = "When true, Terraform manages Workers routes."
  default     = false
}

variable "worker_production_route_pattern" {
  type        = string
  description = "Optional production Worker route pattern override."
  default     = ""
}

variable "worker_preview_route_pattern" {
  type        = string
  description = "Optional preview Worker route pattern override."
  default     = ""
}

variable "worker_domain_environment_production" {
  type        = string
  description = "Legacy production route pattern fallback."
  default     = ""
}

variable "worker_domain_environment_preview" {
  type        = string
  description = "Legacy preview route pattern fallback."
  default     = ""
}

variable "enable_workers_dev_subdomain" {
  type        = bool
  description = "Expose the Worker on workers.dev."
  default     = true
}

variable "enable_workers_dev_previews" {
  type        = bool
  description = "Enable workers.dev preview URLs."
  default     = true
}

variable "enable_worker_observability" {
  type        = bool
  description = "Enable Cloudflare Worker observability."
  default     = true
}

variable "enable_worker_observability_logs" {
  type        = bool
  description = "Enable Worker log observability stream."
  default     = true
}

variable "enable_worker_observability_invocation_logs" {
  type        = bool
  description = "Enable Worker invocation logs."
  default     = true
}

variable "worker_observability_head_sampling_rate" {
  type        = number
  description = "Head sampling rate for observability traces."
  default     = 1.0
}

variable "worker_observability_logs_head_sampling_rate" {
  type        = number
  description = "Head sampling rate for observability logs."
  default     = 1.0
}

variable "worker_compatibility_date" {
  type        = string
  description = "Cloudflare Worker compatibility date."
  default     = "2026-03-09"
}

variable "worker_compatibility_flags" {
  type        = list(string)
  description = "Cloudflare Worker compatibility flags."
  default     = ["nodejs_compat"]
}

variable "environment_name_preview" {
  type        = string
  description = "ENVIRONMENT binding value used for preview deployments."
  default     = "dev"
}

variable "environment_name_production" {
  type        = string
  description = "ENVIRONMENT binding value used for production deployments."
  default     = "prod"
}

variable "service_title" {
  type        = string
  description = "SERVICE_TITLE binding value."
  default     = "MFE Module Registry"
}

variable "google_auth_enabled" {
  type        = string
  description = "GOOGLE_AUTH_ENABLED binding value."
  default     = "true"
}

variable "google_auth_allowed_audiences" {
  type        = string
  description = "GOOGLE_AUTH_ALLOWED_AUDIENCES binding value."
  default     = ""
}

variable "google_auth_allowed_emails" {
  type        = string
  description = "GOOGLE_AUTH_ALLOWED_EMAILS binding value."
  default     = ""
}

variable "google_auth_allowed_domains" {
  type        = string
  description = "GOOGLE_AUTH_ALLOWED_DOMAINS binding value."
  default     = ""
}

variable "google_auth_allowed_groups" {
  type        = string
  description = "GOOGLE_AUTH_ALLOWED_GROUPS binding value."
  default     = "mfe-registry-access@suncoast.systems"
}

variable "google_auth_groups_service_account_email" {
  type        = string
  description = "GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_EMAIL binding value."
  default     = ""
}

variable "google_auth_groups_service_account_private_key" {
  type        = string
  description = "GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_PRIVATE_KEY binding value."
  sensitive   = true
  default     = ""
}

variable "google_auth_groups_impersonated_user" {
  type        = string
  description = "GOOGLE_AUTH_GROUPS_IMPERSONATED_USER binding value."
  default     = ""
}

variable "google_auth_groups_cache_ttl_seconds" {
  type        = number
  description = "GOOGLE_AUTH_GROUPS_CACHE_TTL_SECONDS binding value."
  default     = 300
}
