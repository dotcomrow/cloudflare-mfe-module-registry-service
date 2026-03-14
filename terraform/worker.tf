locals {
  worker_build_dir  = "${path.module}/worker-build"
  worker_entry_file = "${local.worker_build_dir}/index.js"
}

resource "cloudflare_worker" "app" {
  account_id = var.cloudflare_account_id
  name       = local.active_worker_service_name

  observability = {
    enabled            = var.enable_worker_observability
    head_sampling_rate = var.worker_observability_head_sampling_rate
    logs = {
      enabled            = var.enable_worker_observability_logs
      head_sampling_rate = var.worker_observability_logs_head_sampling_rate
      invocation_logs    = var.enable_worker_observability_invocation_logs
    }
  }

  subdomain = {
    enabled          = var.enable_workers_dev_subdomain
    previews_enabled = var.enable_workers_dev_previews
  }
}

resource "cloudflare_worker_version" "app" {
  account_id = var.cloudflare_account_id
  worker_id  = cloudflare_worker.app.id

  compatibility_date  = var.worker_compatibility_date
  compatibility_flags = var.worker_compatibility_flags
  main_module         = "index.js"

  modules = [
    {
      name         = "index.js"
      content_file = local.worker_entry_file
      content_type = "application/javascript+module"
    }
  ]

  bindings = [
    {
      type = "d1"
      name = "REGISTRY_DB"
      id   = local.active_registry_database_id
    },
    {
      type        = "r2_bucket"
      name        = "REGISTRY_ASSETS"
      bucket_name = local.active_r2_assets_bucket_name
    },
    {
      type = "plain_text"
      name = "ENVIRONMENT"
      text = local.active_runtime_environment
    },
    {
      type = "plain_text"
      name = "SERVICE_TITLE"
      text = var.service_title
    },
    {
      type = "plain_text"
      name = "GOOGLE_AUTH_ENABLED"
      text = var.google_auth_enabled
    },
    {
      type = "plain_text"
      name = "GOOGLE_AUTH_ALLOWED_AUDIENCE"
      text = var.google_auth_allowed_audience
    },
    {
      type = "plain_text"
      name = "GOOGLE_AUTH_ALLOWED_AUDIENCES"
      text = local.google_auth_allowed_audiences_effective
    },
    {
      type = "plain_text"
      name = "GOOGLE_AUTH_ALLOWED_EMAILS"
      text = var.google_auth_allowed_emails
    },
    {
      type = "plain_text"
      name = "GOOGLE_AUTH_ALLOWED_DOMAINS"
      text = var.google_auth_allowed_domains
    },
    {
      type = "plain_text"
      name = "GOOGLE_AUTH_ALLOWED_GROUPS"
      text = var.google_auth_allowed_groups
    },
    {
      type = "plain_text"
      name = "GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_EMAIL"
      text = var.google_auth_groups_service_account_email
    },
    {
      type = "plain_text"
      name = "GOOGLE_AUTH_GROUPS_IMPERSONATED_USER"
      text = var.google_auth_groups_impersonated_user
    },
    {
      type = "plain_text"
      name = "GOOGLE_AUTH_GROUPS_CACHE_TTL_SECONDS"
      text = tostring(var.google_auth_groups_cache_ttl_seconds)
    },
    {
      type = "plain_text"
      name = "PUBLISH_UPLOADS_ENABLED"
      text = var.publish_uploads_enabled
    },
    {
      type = "plain_text"
      name = "PUBLISH_UPLOADS_PUBLIC_BASE_URL"
      text = local.active_publish_uploads_public_base_url
    },
    {
      type = "plain_text"
      name = "PUBLISH_UPLOADS_R2_PREFIX"
      text = var.publish_uploads_r2_prefix
    },
    {
      type = "plain_text"
      name = "PUBLISH_UPLOADS_MAX_BUNDLE_BYTES"
      text = tostring(var.publish_uploads_max_bundle_bytes)
    },
    {
      type = "plain_text"
      name = "PUBLISH_UPLOADS_MAX_MANIFEST_BYTES"
      text = tostring(var.publish_uploads_max_manifest_bytes)
    },
    {
      type = "plain_text"
      name = "PUBLISH_VALIDATION_STRICT"
      text = var.publish_validation_strict
    },
    {
      type = "plain_text"
      name = "PUBLISH_VALIDATION_REQUIRE_PROPS_SCHEMA"
      text = var.publish_validation_require_props_schema
    },
    {
      type = "plain_text"
      name = "PUBLISH_VALIDATION_REQUIRE_DEFAULT_PROPS"
      text = var.publish_validation_require_default_props
    },
    {
      type = "plain_text"
      name = "PUBLISH_VALIDATION_VERIFY_ASSET_URLS"
      text = var.publish_validation_verify_asset_urls
    },
    {
      type = "plain_text"
      name = "PUBLISH_VALIDATION_VALIDATE_MANIFEST"
      text = var.publish_validation_validate_manifest
    },
    {
      type = "plain_text"
      name = "PUBLISH_VALIDATION_TIMEOUT_MS"
      text = tostring(var.publish_validation_timeout_ms)
    },
    {
      type = "secret_text"
      name = "GOOGLE_AUTH_GROUPS_SERVICE_ACCOUNT_PRIVATE_KEY"
      text = var.google_auth_groups_service_account_private_key
    }
  ]

  lifecycle {
    precondition {
      condition     = fileexists(local.worker_entry_file)
      error_message = "Missing bundled Worker entrypoint at ${local.worker_entry_file}. Run wrangler deploy --dry-run to terraform/worker-build before Terraform apply."
    }
    precondition {
      condition = trimspace(var.google_auth_allowed_audience) == "" || trimspace(var.google_auth_allowed_audiences) == "" || (
        trimspace(var.google_auth_allowed_audience) == trimspace(var.google_auth_allowed_audiences)
      )
      error_message = "google_auth_allowed_audience and google_auth_allowed_audiences cannot conflict; use one shared audience value."
    }
    precondition {
      condition = trimspace(var.google_auth_allowed_groups) == "" || (
        trimspace(var.google_auth_groups_service_account_email) != "" &&
        trimspace(var.google_auth_groups_service_account_private_key) != "" &&
        trimspace(var.google_auth_groups_impersonated_user) != ""
      )
      error_message = "When google_auth_allowed_groups is set, you must also set google_auth_groups_service_account_email, google_auth_groups_service_account_private_key, and google_auth_groups_impersonated_user."
    }
  }
}

resource "cloudflare_workers_deployment" "app" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker.app.name
  strategy    = "percentage"

  versions = [
    {
      version_id = cloudflare_worker_version.app.id
      percentage = 100
    }
  ]
}
