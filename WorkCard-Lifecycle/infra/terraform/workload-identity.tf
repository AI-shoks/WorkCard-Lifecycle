resource "google_iam_workload_identity_pool" "github_actions" {
  project                   = google_project.environment["release"].project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Short-lived identities restricted to the manual Work Card release workflow."
  disabled                  = false
  deletion_policy           = var.teardown_mode ? "DELETE" : "PREVENT"

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github_actions" {
  project                            = google_project.environment["release"].project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_actions.workload_identity_pool_id
  workload_identity_pool_provider_id = "work-card-release"
  display_name                       = "Work Card release"
  description                        = "Trusts only manual main-branch release.yml runs from the configured immutable GitHub repository IDs."
  deletion_policy                    = var.teardown_mode ? "DELETE" : "PREVENT"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.event_name"          = "assertion.event_name"
    "attribute.ref"                 = "assertion.ref"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.workflow_ref"        = "assertion.workflow_ref"
  }
  attribute_condition = <<-EOT
    assertion.repository_id == "${var.github_repository_id}" &&
    assertion.repository_owner_id == "${var.github_repository_owner_id}" &&
    assertion.ref == "refs/heads/main" &&
    assertion.event_name == "workflow_dispatch" &&
    assertion.workflow_ref == "${var.github_repository}/.github/workflows/release.yml@refs/heads/main"
  EOT

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com/"
  }
}

resource "google_service_account_iam_member" "artifact_publisher_workload_identity" {
  service_account_id = google_service_account.artifact_publisher.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github_actions.name}/attribute.repository_id/${var.github_repository_id}"

  depends_on = [google_iam_workload_identity_pool_provider.github_actions]
}

resource "google_iam_workload_identity_pool" "github_deployment" {
  project                   = google_project.environment["release"].project_id
  workload_identity_pool_id = "github-deployment"
  display_name              = "GitHub deployment"
  description               = "Isolated short-lived identities for the manual Work Card deployment workflow."
  disabled                  = false
  deletion_policy           = var.teardown_mode ? "DELETE" : "PREVENT"

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github_deployment" {
  project                            = google_project.environment["release"].project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_deployment.workload_identity_pool_id
  workload_identity_pool_provider_id = "work-card-deploy"
  display_name                       = "Work Card deployment"
  description                        = "Trusts only manual main-branch deploy.yml runs from the configured immutable GitHub repository IDs."
  deletion_policy                    = var.teardown_mode ? "DELETE" : "PREVENT"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.event_name"          = "assertion.event_name"
    "attribute.ref"                 = "assertion.ref"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.workflow_ref"        = "assertion.workflow_ref"
  }
  attribute_condition = <<-EOT
    assertion.repository_id == "${var.github_repository_id}" &&
    assertion.repository_owner_id == "${var.github_repository_owner_id}" &&
    assertion.ref == "refs/heads/main" &&
    assertion.event_name == "workflow_dispatch" &&
    assertion.workflow_ref == "${var.github_repository}/.github/workflows/deploy.yml@refs/heads/main"
  EOT

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com/"
  }
}

resource "google_service_account_iam_member" "release_deployer_workload_identity" {
  service_account_id = google_service_account.release_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github_deployment.name}/attribute.repository_id/${var.github_repository_id}"

  depends_on = [google_iam_workload_identity_pool_provider.github_deployment]
}

resource "google_service_account_iam_member" "smoke_runner_workload_identity" {
  service_account_id = google_service_account.smoke_runner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github_deployment.name}/attribute.repository_id/${var.github_repository_id}"

  depends_on = [google_iam_workload_identity_pool_provider.github_deployment]
}
