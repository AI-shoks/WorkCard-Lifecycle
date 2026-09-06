resource "google_artifact_registry_repository" "release" {
  project         = google_project.environment["release"].project_id
  location        = var.region
  repository_id   = local.repository_id
  description     = "Immutable build-once images promoted by digest to staging and production."
  format          = "DOCKER"
  mode            = "STANDARD_REPOSITORY"
  deletion_policy = var.teardown_mode ? "DELETE" : "PREVENT"

  docker_config {
    immutable_tags = true
  }

  # No delete cleanup policy is enabled: current, previous and 30-day rollback
  # images remain protected until the release workflow can prove safe retention.
  cleanup_policy_dry_run = true

  labels = merge(local.common_labels, {
    environment = "release"
  })

  depends_on = [google_project_service.required]
}

resource "google_service_account" "artifact_publisher" {
  project         = google_project.environment["release"].project_id
  account_id      = "work-card-publisher"
  display_name    = "Work Card artifact publisher"
  description     = "Writes immutable release images; key creation is intentionally absent."
  deletion_policy = var.teardown_mode ? "DELETE" : "PREVENT"

  depends_on = [google_project_service.required]
}

resource "google_service_account" "release_deployer" {
  project         = google_project.environment["release"].project_id
  account_id      = "work-card-deployer"
  display_name    = "Work Card release deployer"
  description     = "Deploys revisions and runs jobs. No direct secretAccessor; actAs can indirectly exercise workload permissions."
  deletion_policy = var.teardown_mode ? "DELETE" : "PREVENT"

  depends_on = [google_project_service.required]
}

resource "google_service_account" "smoke_runner" {
  project         = google_project.environment["release"].project_id
  account_id      = "work-card-smoke"
  display_name    = "Work Card staging smoke runner"
  description     = "Invokes only the private staging service; no database or owner access."
  deletion_policy = var.teardown_mode ? "DELETE" : "PREVENT"

  depends_on = [google_project_service.required]
}

resource "google_artifact_registry_repository_iam_member" "publisher" {
  project    = google_artifact_registry_repository.release.project
  location   = google_artifact_registry_repository.release.location
  repository = google_artifact_registry_repository.release.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.artifact_publisher.email}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_reader" {
  project    = google_artifact_registry_repository.release.project
  location   = google_artifact_registry_repository.release.location
  repository = google_artifact_registry_repository.release.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.release_deployer.email}"
}

resource "google_artifact_registry_repository_iam_member" "cloud_run_reader" {
  for_each = local.runtime_environments

  project    = google_artifact_registry_repository.release.project
  location   = google_artifact_registry_repository.release.location
  repository = google_artifact_registry_repository.release.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${google_project.environment[each.key].number}@serverless-robot-prod.iam.gserviceaccount.com"

  depends_on = [google_project_service.required]
}
