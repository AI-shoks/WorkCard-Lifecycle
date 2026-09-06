variable "project_id" {
  description = "Runtime GCP project ID."
  type        = string
}

variable "environment" {
  description = "Runtime environment."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment должен быть staging или production."
  }
}

variable "region" {
  description = "Cloud Run and Cloud SQL region."
  type        = string
}

variable "source_sha" {
  description = "Full source commit SHA."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.source_sha))
    error_message = "source_sha должен содержать 40 lowercase hex символов."
  }
}

variable "image" {
  description = "Artifact Registry image pinned by sha256 digest."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[a-z][a-z0-9-]{4,28}[a-z0-9]/[a-z0-9-]+/[a-z0-9-]+@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image должен быть Artifact Registry reference с exact sha256 digest."
  }
}

variable "app_origin" {
  description = "Exact canonical Cloud Run HTTPS origin."
  type        = string
}

variable "cloud_sql_tier" {
  description = "Cloud SQL machine tier."
  type        = string
}

variable "jobs_enabled" {
  description = "Create migrate, reset, seed and verify jobs."
  type        = bool
}

variable "service_enabled" {
  description = "Create the application service."
  type        = bool
}

variable "public_service" {
  description = "Grant allUsers run.invoker; true only for production."
  type        = bool
}

variable "enable_pitr" {
  description = "Enable PostgreSQL point-in-time recovery."
  type        = bool
}

variable "retained_backups" {
  description = "Count of automated backups retained."
  type        = number

  validation {
    condition     = var.retained_backups >= 1
    error_message = "retained_backups должен быть положительным."
  }
}

variable "secret_values" {
  description = "Write-only environment payloads; never persisted in plan or state."
  type = object({
    owner_database_password = string
    app_database_password   = string
    session_signing_secret  = string
  })
  sensitive = true
  ephemeral = true
}

variable "secret_generations" {
  description = "Monotonic write-only rotation counters."
  type = object({
    owner_database_password = number
    database_url            = number
    migration_database_url  = number
    app_database_password   = number
    session_signing_secret  = number
  })
}

variable "release_deployer_member" {
  description = "Release identity IAM member."
  type        = string
}

variable "smoke_invoker_member" {
  description = "Staging-only IAM member allowed to invoke the private service."
  type        = string
  default     = null
  nullable    = true
}

variable "notification_channels" {
  description = "Monitoring notification channel resource names."
  type        = list(string)
}

variable "database_connection_alert_threshold" {
  description = "PostgreSQL backend count warning threshold."
  type        = number
}

variable "common_labels" {
  description = "Shared resource labels."
  type        = map(string)
  default     = {}
}

variable "teardown_mode" {
  description = "Explicitly disable deletion guards for the separately approved teardown sequence."
  type        = bool
  default     = false
}

check "environment_safety_profile" {
  assert {
    condition = (
      var.environment == "production" && var.public_service && var.enable_pitr
      ) || (
      var.environment == "staging" && !var.public_service && !var.enable_pitr
    )
    error_message = "Production должен быть public+PITR, staging — private без обязательного PITR."
  }
}

check "staging_smoke_identity" {
  assert {
    condition = (
      var.environment == "staging" && var.smoke_invoker_member != null
      ) || (
      var.environment == "production" && var.smoke_invoker_member == null
    )
    error_message = "Smoke invoker выдаётся только private staging service."
  }
}
