resource "google_secret_manager_secret" "workload" {
  for_each = local.secret_ids

  project             = var.project_id
  secret_id           = each.value
  deletion_protection = !var.teardown_mode
  deletion_policy     = var.teardown_mode ? "DELETE" : "PREVENT"
  version_destroy_ttl = "2592000s"

  replication {
    auto {}
  }

  labels = merge(local.labels, {
    purpose = replace(each.key, "_", "-")
  })
}

locals {
  cloud_sql_socket = "/cloudsql/${google_sql_database_instance.primary.connection_name}"
  runtime_database_url = join("", [
    "postgresql://${local.app_database_user}:",
    urlencode(var.secret_values.app_database_password),
    "@/${local.database_name}?host=",
    urlencode(local.cloud_sql_socket),
    "&sslmode=disable",
  ])
  migration_database_url = join("", [
    "postgresql://${local.owner_database_user}:",
    urlencode(var.secret_values.owner_database_password),
    "@/${local.database_name}?host=",
    urlencode(local.cloud_sql_socket),
    "&sslmode=disable",
  ])
}

resource "google_secret_manager_secret_version" "database_url" {
  secret                 = google_secret_manager_secret.workload["database_url"].id
  secret_data_wo         = local.runtime_database_url
  secret_data_wo_version = var.secret_generations.database_url
  deletion_policy        = "DISABLE"

  depends_on = [google_sql_database.application]
}

resource "google_secret_manager_secret_version" "migration_database_url" {
  secret                 = google_secret_manager_secret.workload["migration_database_url"].id
  secret_data_wo         = local.migration_database_url
  secret_data_wo_version = var.secret_generations.migration_database_url
  deletion_policy        = "DISABLE"

  depends_on = [google_sql_database.application]
}

resource "google_secret_manager_secret_version" "app_database_password" {
  secret                 = google_secret_manager_secret.workload["app_database_password"].id
  secret_data_wo         = var.secret_values.app_database_password
  secret_data_wo_version = var.secret_generations.app_database_password
  deletion_policy        = "DISABLE"
}

resource "google_secret_manager_secret_version" "session_signing_secret" {
  secret                 = google_secret_manager_secret.workload["session_signing_secret"].id
  secret_data_wo         = var.secret_values.session_signing_secret
  secret_data_wo_version = var.secret_generations.session_signing_secret
  deletion_policy        = "DISABLE"
}

locals {
  secret_versions = {
    database_url           = google_secret_manager_secret_version.database_url.version
    migration_database_url = google_secret_manager_secret_version.migration_database_url.version
    app_database_password  = google_secret_manager_secret_version.app_database_password.version
    session_signing_secret = google_secret_manager_secret_version.session_signing_secret.version
  }
}
