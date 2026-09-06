resource "google_project_iam_member" "release_deployer" {
  for_each = local.deployer_role_bindings

  project = google_project.environment[each.value.environment].project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.release_deployer.email}"
}
