locals {
  service_name        = "work-card-app"
  sql_instance_name   = "work-card-${var.environment}"
  database_name       = "work_card"
  app_database_user   = "work_card_app"
  owner_database_user = "postgres"

  labels = merge(var.common_labels, {
    environment = var.environment
  })

  revision_labels = merge(local.labels, {
    source-sha = var.source_sha
  })

  workload_accounts = {
    app = {
      account_id   = "work-card-app"
      display_name = "Work Card application (${var.environment})"
    }
    migrate = {
      account_id   = "work-card-migrate"
      display_name = "Work Card migration job (${var.environment})"
    }
    reset = {
      account_id   = "work-card-reset"
      display_name = "Work Card demo reset job (${var.environment})"
    }
    seed = {
      account_id   = "work-card-seed"
      display_name = "Work Card seed job (${var.environment})"
    }
    verify = {
      account_id   = "work-card-verify"
      display_name = "Work Card verification job (${var.environment})"
    }
  }

  secret_ids = {
    database_url           = "work-card-database-url"
    migration_database_url = "work-card-migration-database-url"
    app_database_password  = "work-card-app-database-password"
    session_signing_secret = "work-card-session-signing-secret"
  }

  secret_access = {
    "app/database-url" = {
      workload = "app"
      secret   = "database_url"
    }
    "app/session-signing-secret" = {
      workload = "app"
      secret   = "session_signing_secret"
    }
    "migrate/migration-database-url" = {
      workload = "migrate"
      secret   = "migration_database_url"
    }
    "migrate/app-database-password" = {
      workload = "migrate"
      secret   = "app_database_password"
    }
    "reset/migration-database-url" = {
      workload = "reset"
      secret   = "migration_database_url"
    }
    "seed/migration-database-url" = {
      workload = "seed"
      secret   = "migration_database_url"
    }
    "seed/app-database-password" = {
      workload = "seed"
      secret   = "app_database_password"
    }
    "verify/database-url" = {
      workload = "verify"
      secret   = "database_url"
    }
  }

  job_names = {
    migrate = "work-card-migrate"
    reset   = "work-card-reset"
    seed    = "work-card-seed"
    verify  = "work-card-verify"
  }

  app_host = trimprefix(var.app_origin, "https://")
}
