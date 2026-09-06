output "project_ids" {
  description = "Создаваемые environment project IDs."
  value = {
    for environment, project in google_project.environment : environment => project.project_id
  }
}

output "artifact_repository" {
  description = "Artifact Registry repository и exact release image."
  value = {
    repository = google_artifact_registry_repository.release.registry_uri
    image      = local.immutable_image
  }
}

output "release_identities" {
  description = "Keyless service identities для публикации, deployment и smoke."
  value = {
    artifact_publisher = google_service_account.artifact_publisher.email
    release_deployer   = google_service_account.release_deployer.email
    smoke_runner       = google_service_account.smoke_runner.email
  }
}

output "release_workload_identity" {
  description = "Несекретная конфигурация GitHub Actions Workload Identity для repository variables."
  value = {
    provider                  = google_iam_workload_identity_pool_provider.github_actions.name
    publisher_service_account = google_service_account.artifact_publisher.email
    repository                = var.github_repository
    repository_id             = var.github_repository_id
    repository_owner_id       = var.github_repository_owner_id
    ref                       = "refs/heads/main"
    workflow                  = ".github/workflows/release.yml"
    event                     = "workflow_dispatch"
  }
}

output "deployment_workload_identity" {
  description = "Keyless identity reserved for the future deployment orchestration workflow."
  value = {
    provider                 = google_iam_workload_identity_pool_provider.github_deployment.name
    deployer_service_account = google_service_account.release_deployer.email
    repository               = var.github_repository
    repository_id            = var.github_repository_id
    repository_owner_id      = var.github_repository_owner_id
    ref                      = "refs/heads/main"
    workflow                 = ".github/workflows/deploy.yml"
    event                    = "workflow_dispatch"
  }
}

output "runtime" {
  description = "Несекретные имена runtime resources и safety settings."
  value = {
    staging    = module.staging.summary
    production = module.production.summary
  }
}
