variable "region" {
  description = "Единый регион Artifact Registry, Cloud Run и Cloud SQL."
  type        = string
  default     = "europe-west1"

  validation {
    condition     = var.region == "europe-west1"
    error_message = "Первый release зафиксирован в регионе europe-west1."
  }
}

variable "organization_id" {
  description = "Числовой ID GCP organization. Задайте ровно один из organization_id и folder_id."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.organization_id == null || can(regex("^[0-9]+$", var.organization_id))
    error_message = "organization_id должен быть числовым GCP organization ID."
  }
}

variable "folder_id" {
  description = "Числовой ID GCP folder. Задайте ровно один из organization_id и folder_id."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.folder_id == null || can(regex("^[0-9]+$", var.folder_id))
    error_message = "folder_id должен быть числовым GCP folder ID."
  }
}

variable "billing_account_id" {
  description = "Billing account для трёх изолированных проектов."
  type        = string

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account_id))
    error_message = "billing_account_id должен иметь формат 000000-000000-000000."
  }
}

variable "project_ids" {
  description = "Глобально уникальные ID release, staging и production проектов."
  type = object({
    release    = string
    staging    = string
    production = string
  })

  validation {
    condition = alltrue([
      for project_id in values(var.project_ids) :
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", project_id))
    ])
    error_message = "Каждый project ID должен соответствовать правилам GCP и иметь длину 6–30 символов."
  }

  validation {
    condition     = length(toset(values(var.project_ids))) == 3
    error_message = "Release, staging и production должны использовать разные GCP projects."
  }
}

variable "github_repository" {
  description = "GitHub repository в формате owner/name, которому разрешён ручной release workflow."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository должен иметь формат owner/name."
  }
}

variable "github_repository_id" {
  description = "Неизменяемый числовой GitHub repository ID для OIDC trust condition."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.github_repository_id))
    error_message = "github_repository_id должен быть положительным числовым GitHub ID."
  }
}

variable "github_repository_owner_id" {
  description = "Неизменяемый числовой GitHub owner/organization ID для OIDC trust condition."
  type        = string

  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.github_repository_owner_id))
    error_message = "github_repository_owner_id должен быть положительным числовым GitHub ID."
  }
}

variable "source_sha" {
  description = "Полный lowercase Git SHA единственного release build."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.source_sha))
    error_message = "source_sha должен содержать ровно 40 lowercase hex символов."
  }
}

variable "image_digest" {
  description = "Digest опубликованного release image без mutable tag."
  type        = string

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.image_digest))
    error_message = "image_digest должен иметь формат sha256:<64 lowercase hex>."
  }
}

variable "app_origins" {
  description = "Канонические Cloud Run origins без path/query/trailing slash."
  type = object({
    staging    = string
    production = string
  })

  validation {
    condition = alltrue([
      for origin in values(var.app_origins) :
      can(regex("^https://[a-z0-9.-]+\\.run\\.app$", origin))
    ])
    error_message = "Каждый APP_ORIGIN должен быть каноническим HTTPS origin Cloud Run без path, query или trailing slash."
  }

  validation {
    condition     = var.app_origins.staging != var.app_origins.production
    error_message = "Staging и production должны иметь разные APP_ORIGIN."
  }
}

variable "alert_email_addresses" {
  description = "Email-каналы для operational и budget alerts; Google отправит запрос подтверждения."
  type        = set(string)

  validation {
    condition     = length(var.alert_email_addresses) >= 1 && length(var.alert_email_addresses) <= 5
    error_message = "Укажите от одного до пяти email-адресов для alerts."
  }

  validation {
    condition = alltrue([
      for address in var.alert_email_addresses :
      can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", address))
    ])
    error_message = "Каждый alert email должен иметь корректный формат."
  }
}

variable "budget" {
  description = "Месячные budget thresholds; currency должна совпадать с валютой billing account."
  type = object({
    currency_code = string
    monthly_amounts = object({
      release    = number
      staging    = number
      production = number
    })
  })

  validation {
    condition     = can(regex("^[A-Z]{3}$", var.budget.currency_code))
    error_message = "budget.currency_code должен быть трёхбуквенным ISO 4217 code."
  }

  validation {
    condition = alltrue([
      for amount in values(var.budget.monthly_amounts) :
      amount > 0 && amount == floor(amount)
    ])
    error_message = "Каждый месячный budget должен быть положительным целым числом."
  }
}

variable "cloud_sql_tiers" {
  description = "Явные Cloud SQL tiers для оценки постоянной стоимости до apply."
  type = object({
    staging    = string
    production = string
  })
  default = {
    staging    = "db-f1-micro"
    production = "db-f1-micro"
  }
}

variable "workload_enablement" {
  description = "Фазовые switches: foundation -> jobs -> service. Review-plan включает все workloads."
  type = object({
    staging = object({
      jobs    = bool
      service = bool
    })
    production = object({
      jobs    = bool
      service = bool
    })
  })

  validation {
    condition = alltrue([
      for environment in values(var.workload_enablement) :
      !environment.service || environment.jobs
    ])
    error_message = "Cloud Run service можно включить только в фазе с уже описанными migrate/reset/seed/verify jobs."
  }
}

variable "secret_generations" {
  description = "Несекретные монотонные counters write-only значений; увеличиваются при каждой ротации."
  type = object({
    staging = object({
      owner_database_password = number
      database_url            = number
      migration_database_url  = number
      app_database_password   = number
      session_signing_secret  = number
    })
    production = object({
      owner_database_password = number
      database_url            = number
      migration_database_url  = number
      app_database_password   = number
      session_signing_secret  = number
    })
  })

  validation {
    condition = alltrue(flatten([
      for environment in values(var.secret_generations) : [
        for generation in values(environment) :
        generation >= 1 && generation == floor(generation)
      ]
    ]))
    error_message = "Каждый secret generation должен быть положительным целым числом."
  }
}

variable "staging_secret_values" {
  description = "Staging payloads. Передаются только через защищённый ephemeral input и не сохраняются в plan/state."
  type = object({
    owner_database_password = string
    app_database_password   = string
    session_signing_secret  = string
  })
  sensitive = true
  ephemeral = true

  validation {
    condition = alltrue([
      for value in values(var.staging_secret_values) : length(value) >= 32
    ])
    error_message = "Каждый staging secret должен содержать минимум 32 символа."
  }

  validation {
    condition     = length(toset(values(var.staging_secret_values))) == 3
    error_message = "Staging DB owner, runtime DB и session secrets должны различаться."
  }
}

variable "production_secret_values" {
  description = "Production payloads. Передаются только через защищённый ephemeral input и не сохраняются в plan/state."
  type = object({
    owner_database_password = string
    app_database_password   = string
    session_signing_secret  = string
  })
  sensitive = true
  ephemeral = true

  validation {
    condition = alltrue([
      for value in values(var.production_secret_values) : length(value) >= 32
    ])
    error_message = "Каждый production secret должен содержать минимум 32 символа."
  }

  validation {
    condition     = length(toset(values(var.production_secret_values))) == 3
    error_message = "Production DB owner, runtime DB и session secrets должны различаться."
  }
}

variable "common_labels" {
  description = "Дополнительные несекретные labels для всех поддерживающих ресурсов."
  type        = map(string)
  default     = {}
}

variable "database_connection_alert_threshold" {
  description = "Warning threshold для PostgreSQL backends; первый service instance имеет pool не более 10."
  type        = number
  default     = 8

  validation {
    condition     = var.database_connection_alert_threshold >= 1
    error_message = "database_connection_alert_threshold должен быть положительным."
  }
}

variable "teardown_mode" {
  description = "Явно снимает deletion guards только для двухфазного одобренного teardown. Обычные plan/apply обязаны оставлять false."
  type        = bool
  default     = false
}

check "single_project_parent" {
  assert {
    condition     = (var.organization_id != null) != (var.folder_id != null)
    error_message = "Задайте ровно один project parent: organization_id или folder_id."
  }
}

check "environment_secrets_are_isolated" {
  assert {
    condition = length(setintersection(
      toset(values(var.staging_secret_values)),
      toset(values(var.production_secret_values)),
    )) == 0
    error_message = "Staging и production не должны разделять secret payloads."
  }
}
