resource "google_cloud_run_v2_service" "app" {
  count = var.service_enabled ? 1 : 0

  project              = var.project_id
  name                 = local.service_name
  location             = var.region
  description          = "Work Card SPA/API ${var.environment} service pinned to one release digest."
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  deletion_protection  = !var.teardown_mode
  deletion_policy      = var.teardown_mode ? "DELETE" : "PREVENT"
  labels               = local.labels

  scaling {
    scaling_mode       = "AUTOMATIC"
    min_instance_count = 0
    max_instance_count = 1
  }

  template {
    service_account                  = google_service_account.workload["app"].email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    timeout                          = "30s"
    max_instance_request_concurrency = 20
    labels                           = local.revision_labels

    containers {
      name    = "app"
      image   = var.image
      command = ["node"]
      args    = ["dist/server.js"]

      ports {
        name           = "http1"
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "APP_ENV"
        value = var.environment
      }

      env {
        name  = "APP_VERSION"
        value = var.source_sha
      }

      env {
        name  = "APP_ORIGIN"
        value = var.app_origin
      }

      env {
        name  = "HOST"
        value = "0.0.0.0"
      }

      env {
        name  = "LOG_LEVEL"
        value = "info"
      }

      env {
        name  = "DEMO_MAX_BATCHES"
        value = "20"
      }

      env {
        name  = "DEMO_MAX_SESSIONS"
        value = "500"
      }

      env {
        name  = "PROXY_TRUST_MODE"
        value = "cloud-run"
      }

      env {
        name  = "WEB_DIST_PATH"
        value = "/opt/work-card/public"
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.workload["database_url"].secret_id
            version = local.secret_versions.database_url
          }
        }
      }

      env {
        name = "SESSION_SIGNING_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.workload["session_signing_secret"].secret_id
            version = local.secret_versions.session_signing_secret
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      startup_probe {
        initial_delay_seconds = 0
        period_seconds        = 5
        timeout_seconds       = 3
        failure_threshold     = 24

        http_get {
          path = "/health/ready"
          port = 3000
        }
      }

      liveness_probe {
        initial_delay_seconds = 0
        period_seconds        = 10
        timeout_seconds       = 3
        failure_threshold     = 3

        http_get {
          path = "/health/live"
          port = 3000
        }
      }
    }

    volumes {
      name = "cloudsql"

      cloud_sql_instance {
        instances = [google_sql_database_instance.primary.connection_name]
      }
    }
  }

  # Release automation creates a candidate revision without traffic, validates
  # it, then promotes/rolls back explicitly. Terraform must not undo that state.
  lifecycle {
    ignore_changes = [traffic]

    postcondition {
      condition     = self.uri == var.app_origin
      error_message = "APP_ORIGIN должен точно совпасть с выданным Cloud Run service URI."
    }
  }

  depends_on = [
    google_project_iam_member.cloud_sql_client,
    google_secret_manager_secret_iam_member.accessor,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  count = var.service_enabled && var.public_service ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker_policy_operator" {
  count = var.service_enabled && var.public_service ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[0].name
  role     = google_project_iam_custom_role.public_invoker_policy_operator[0].name
  member   = var.release_deployer_member
}

resource "google_cloud_run_v2_service_iam_member" "smoke" {
  count = var.service_enabled && var.smoke_invoker_member != null ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[0].name
  role     = "roles/run.invoker"
  member   = var.smoke_invoker_member
}

locals {
  job_specs = {
    migrate = {
      command         = ["node"]
      args            = ["dist/migrate.js"]
      timeout         = "900s"
      service_account = google_service_account.workload["migrate"].email
      plain_environment = {
        APP_DATABASE_USER = local.app_database_user
        APP_ENV           = var.environment
        APP_VERSION       = var.source_sha
        LOG_LEVEL         = "info"
      }
      secret_environment = {
        MIGRATION_DATABASE_URL = {
          secret  = google_secret_manager_secret.workload["migration_database_url"].secret_id
          version = local.secret_versions.migration_database_url
        }
        APP_DATABASE_PASSWORD = {
          secret  = google_secret_manager_secret.workload["app_database_password"].secret_id
          version = local.secret_versions.app_database_password
        }
      }
    }
    reset = {
      command         = ["node"]
      args            = ["dist/reset-demo.js"]
      timeout         = "600s"
      service_account = google_service_account.workload["reset"].email
      plain_environment = {
        APP_ENV     = var.environment
        APP_VERSION = var.source_sha
        LOG_LEVEL   = "info"
      }
      secret_environment = {
        MIGRATION_DATABASE_URL = {
          secret  = google_secret_manager_secret.workload["migration_database_url"].secret_id
          version = local.secret_versions.migration_database_url
        }
      }
    }
    seed = {
      command         = ["node"]
      args            = ["dist/seed.js"]
      timeout         = "600s"
      service_account = google_service_account.workload["seed"].email
      plain_environment = {
        APP_DATABASE_USER = local.app_database_user
        APP_ENV           = var.environment
        APP_VERSION       = var.source_sha
        LOG_LEVEL         = "info"
      }
      secret_environment = {
        MIGRATION_DATABASE_URL = {
          secret  = google_secret_manager_secret.workload["migration_database_url"].secret_id
          version = local.secret_versions.migration_database_url
        }
        APP_DATABASE_PASSWORD = {
          secret  = google_secret_manager_secret.workload["app_database_password"].secret_id
          version = local.secret_versions.app_database_password
        }
      }
    }
    verify = {
      command         = ["node"]
      args            = ["dist/verify-database.js"]
      timeout         = "300s"
      service_account = google_service_account.workload["verify"].email
      plain_environment = {
        APP_DATABASE_USER = local.app_database_user
        APP_ENV           = var.environment
        APP_VERSION       = var.source_sha
        LOG_LEVEL         = "info"
      }
      secret_environment = {
        DATABASE_URL = {
          secret  = google_secret_manager_secret.workload["database_url"].secret_id
          version = local.secret_versions.database_url
        }
      }
    }
  }
}

resource "google_cloud_run_v2_job" "database" {
  for_each = var.jobs_enabled ? local.job_specs : {}

  project             = var.project_id
  name                = local.job_names[each.key]
  location            = var.region
  deletion_protection = !var.teardown_mode
  deletion_policy     = var.teardown_mode ? "DELETE" : "PREVENT"
  labels              = merge(local.labels, { workload = each.key })

  template {
    task_count  = 1
    parallelism = 1
    labels      = local.revision_labels

    template {
      service_account       = each.value.service_account
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
      max_retries           = 0
      timeout               = each.value.timeout

      containers {
        name    = each.key
        image   = var.image
        command = each.value.command
        args    = each.value.args

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        dynamic "env" {
          for_each = each.value.plain_environment
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = each.value.secret_environment
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value.secret
                version = env.value.version
              }
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      volumes {
        name = "cloudsql"

        cloud_sql_instance {
          instances = [google_sql_database_instance.primary.connection_name]
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.cloud_sql_client,
    google_secret_manager_secret_iam_member.accessor,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "release_execute" {
  for_each = google_cloud_run_v2_job.database

  project  = var.project_id
  location = var.region
  name     = each.value.name
  role     = "roles/run.jobsExecutor"
  member   = var.release_deployer_member
}
