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

variable "manage_r2_resources" {
  type        = bool
  description = "When true, Terraform creates R2 buckets; when false it references bucket names only."
  default     = true
}

variable "r2_dev_assets_bucket_name" {
  type        = string
  description = "Preview R2 bucket used to store uploaded module assets."
  default     = "mfe-module-registry-dev-assets"
}

variable "r2_prod_assets_bucket_name" {
  type        = string
  description = "Production R2 bucket used to store uploaded module assets."
  default     = "mfe-module-registry-prod-assets"
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
  default     = true
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
  default     = false
}

variable "enable_worker_observability_logs" {
  type        = bool
  description = "Enable Worker log observability stream."
  default     = false
}

variable "enable_worker_observability_invocation_logs" {
  type        = bool
  description = "Enable Worker invocation logs."
  default     = false
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

variable "auth_apps_read_token" {
  type        = string
  description = "Optional bearer token required for reading auth app registry endpoints."
  default     = ""
  sensitive   = true
}

variable "google_auth_enabled" {
  type        = string
  description = "GOOGLE_AUTH_ENABLED binding value."
  default     = "true"
}

variable "google_auth_allowed_audience" {
  type        = string
  description = "Single shared audience value for GOOGLE_AUTH_ALLOWED_AUDIENCE (applies to preview and production)."
  default     = "https://cloudflare-mfe-module-registry-service.suncoast.systems/"

  validation {
    condition     = trimspace(var.google_auth_allowed_audience) == "" || length(regexall(",", trimspace(var.google_auth_allowed_audience))) == 0
    error_message = "google_auth_allowed_audience must contain only one audience value (no commas)."
  }
}

variable "google_auth_allowed_audiences" {
  type        = string
  description = "Legacy CSV value for GOOGLE_AUTH_ALLOWED_AUDIENCES (used when google_auth_allowed_audience is empty)."
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

variable "keycloak_auth_enabled" {
  type        = string
  description = "KEYCLOAK_AUTH_ENABLED binding value."
  default     = "true"
}

variable "keycloak_auth_issuer" {
  type        = string
  description = "Optional KEYCLOAK_AUTH_ISSUER binding value. If empty, the publish token `iss` claim is used."
  default     = ""
}

variable "keycloak_auth_userinfo_url" {
  type        = string
  description = "Optional KEYCLOAK_AUTH_USERINFO_URL binding value. When empty, defaults to <issuer>/protocol/openid-connect/userinfo."
  default     = ""
}

variable "keycloak_auth_userinfo_timeout_ms" {
  type        = string
  description = "Optional KEYCLOAK_AUTH_USERINFO_TIMEOUT_MS binding value for userinfo request timeout."
  default     = "30000"
}

variable "keycloak_auth_required_role" {
  type        = string
  description = "KEYCLOAK_AUTH_REQUIRED_ROLE binding value."
  default     = "mfe-registry-access"
}

variable "keycloak_auth_audience" {
  type        = string
  description = "KEYCLOAK_AUTH_AUDIENCE binding value."
  default     = ""
}

variable "publish_uploads_enabled" {
  type        = string
  description = "PUBLISH_UPLOADS_ENABLED binding value."
  default     = "true"
}

variable "publish_uploads_public_base_url_preview" {
  type        = string
  description = "Optional preview public base URL override for uploaded assets. Defaults to the Worker origin + /assets."
  default     = ""
}

variable "publish_uploads_public_base_url_production" {
  type        = string
  description = "Optional production public base URL override for uploaded assets. Defaults to the Worker origin + /assets."
  default     = ""
}

variable "publish_uploads_r2_prefix" {
  type        = string
  description = "PUBLISH_UPLOADS_R2_PREFIX binding value."
  default     = "modules"
}

variable "publish_uploads_max_bundle_bytes" {
  type        = number
  description = "PUBLISH_UPLOADS_MAX_BUNDLE_BYTES binding value."
  default     = 52428800
}

variable "publish_uploads_max_manifest_bytes" {
  type        = number
  description = "PUBLISH_UPLOADS_MAX_MANIFEST_BYTES binding value."
  default     = 5242880
}

variable "publish_validation_strict" {
  type        = string
  description = "PUBLISH_VALIDATION_STRICT binding value."
  default     = "true"
}

variable "publish_validation_require_props_schema" {
  type        = string
  description = "PUBLISH_VALIDATION_REQUIRE_PROPS_SCHEMA binding value."
  default     = "true"
}

variable "publish_validation_require_default_props" {
  type        = string
  description = "PUBLISH_VALIDATION_REQUIRE_DEFAULT_PROPS binding value."
  default     = "true"
}

variable "publish_validation_verify_asset_urls" {
  type        = string
  description = "PUBLISH_VALIDATION_VERIFY_ASSET_URLS binding value."
  default     = "false"
}

variable "publish_validation_validate_manifest" {
  type        = string
  description = "PUBLISH_VALIDATION_VALIDATE_MANIFEST binding value."
  default     = "true"
}

variable "publish_validation_timeout_ms" {
  type        = number
  description = "PUBLISH_VALIDATION_TIMEOUT_MS binding value."
  default     = 8000
}
