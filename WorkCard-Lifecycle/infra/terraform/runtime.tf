module "staging" {
  source = "./modules/runtime"

  project_id     = google_project.environment["staging"].project_id
  environment    = "staging"
  region         = var.region
  source_sha     = var.source_sha
  image          = local.immutable_image
  app_origin     = var.app_origins.staging
  cloud_sql_tier = var.cloud_sql_tiers.staging

  jobs_enabled     = var.workload_enablement.staging.jobs
  service_enabled  = var.workload_enablement.staging.service
  public_service   = false
  enable_pitr      = false
  retained_backups = 3

  secret_values      = var.staging_secret_values
  secret_generations = var.secret_generations.staging

  release_deployer_member = "serviceAccount:${google_service_account.release_deployer.email}"
  smoke_invoker_member    = "serviceAccount:${google_service_account.smoke_runner.email}"
  notification_channels = [
    for key, channel in google_monitoring_notification_channel.email :
    channel.name if local.alert_channels[key].environment == "staging"
  ]
  database_connection_alert_threshold = var.database_connection_alert_threshold
  common_labels                       = local.common_labels
  teardown_mode                       = var.teardown_mode

  depends_on = [google_project_service.required]
}

module "production" {
  source = "./modules/runtime"

  project_id     = google_project.environment["production"].project_id
  environment    = "production"
  region         = var.region
  source_sha     = var.source_sha
  image          = local.immutable_image
  app_origin     = var.app_origins.production
  cloud_sql_tier = var.cloud_sql_tiers.production

  jobs_enabled     = var.workload_enablement.production.jobs
  service_enabled  = var.workload_enablement.production.service
  public_service   = true
  enable_pitr      = true
  retained_backups = 7

  secret_values      = var.production_secret_values
  secret_generations = var.secret_generations.production

  release_deployer_member = "serviceAccount:${google_service_account.release_deployer.email}"
  smoke_invoker_member    = null
  notification_channels = [
    for key, channel in google_monitoring_notification_channel.email :
    channel.name if local.alert_channels[key].environment == "production"
  ]
  database_connection_alert_threshold = var.database_connection_alert_threshold
  common_labels                       = local.common_labels
  teardown_mode                       = var.teardown_mode

  depends_on = [google_project_service.required]
}
