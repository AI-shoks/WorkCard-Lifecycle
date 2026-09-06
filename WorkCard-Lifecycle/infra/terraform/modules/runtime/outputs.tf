output "service_uri" {
  description = "Cloud Run service URI, or null until the service phase is enabled."
  value       = try(google_cloud_run_v2_service.app[0].uri, null)
}

output "summary" {
  description = "Reviewable non-secret runtime summary."
  value = {
    project_id             = var.project_id
    environment            = var.environment
    service_name           = var.service_enabled ? local.service_name : null
    service_uri            = try(google_cloud_run_v2_service.app[0].uri, null)
    public_service         = var.public_service
    jobs                   = var.jobs_enabled ? local.job_names : {}
    cloud_sql_instance     = google_sql_database_instance.primary.name
    cloud_sql_connection   = google_sql_database_instance.primary.connection_name
    cloud_sql_tier         = var.cloud_sql_tier
    automated_backups      = true
    retained_backups       = var.retained_backups
    pitr_enabled           = var.enable_pitr
    log_retention_days     = google_logging_project_bucket_config.default.retention_days
    secret_resource_ids    = local.secret_ids
    pinned_secret_versions = local.secret_versions
    workload_service_accounts = {
      for workload, account in google_service_account.workload : workload => account.email
    }
  }
}
