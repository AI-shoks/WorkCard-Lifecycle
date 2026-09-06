resource "google_sql_database_instance" "primary" {
  project          = var.project_id
  name             = local.sql_instance_name
  region           = var.region
  database_version = "POSTGRES_18"

  root_password_wo         = var.secret_values.owner_database_password
  root_password_wo_version = var.secret_generations.owner_database_password

  deletion_protection = !var.teardown_mode
  deletion_policy     = var.teardown_mode ? "DELETE" : "PREVENT"

  settings {
    tier                        = var.cloud_sql_tier
    edition                     = "ENTERPRISE"
    availability_type           = "ZONAL"
    activation_policy           = "ALWAYS"
    connector_enforcement       = "REQUIRED"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    disk_autoresize             = true
    disk_autoresize_limit       = 50
    deletion_protection_enabled = !var.teardown_mode
    retain_backups_on_delete    = var.enable_pitr && !var.teardown_mode

    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      location                       = var.region
      point_in_time_recovery_enabled = var.enable_pitr
      transaction_log_retention_days = var.enable_pitr ? 7 : null

      backup_retention_settings {
        retained_backups = var.retained_backups
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7
      hour         = 3
      update_track = "stable"
    }

    database_flags {
      name  = "log_connections"
      value = "on"
    }

    database_flags {
      name  = "log_disconnections"
      value = "on"
    }

    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }

    user_labels = local.labels
  }
}

resource "google_sql_database" "application" {
  project   = var.project_id
  name      = local.database_name
  instance  = google_sql_database_instance.primary.name
  charset   = "UTF8"
  collation = "en_US.UTF8"

  deletion_policy = var.teardown_mode ? "DELETE" : "PREVENT"
}
