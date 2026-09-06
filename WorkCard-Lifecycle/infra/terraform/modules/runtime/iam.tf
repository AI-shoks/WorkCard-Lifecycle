resource "google_service_account" "workload" {
  for_each = local.workload_accounts

  project         = var.project_id
  account_id      = each.value.account_id
  display_name    = each.value.display_name
  description     = "Dedicated ${each.key} identity. User-managed key creation is intentionally absent."
  deletion_policy = var.teardown_mode ? "DELETE" : "PREVENT"
}

resource "google_project_iam_member" "cloud_sql_client" {
  for_each = google_service_account.workload

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${each.value.email}"
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = local.secret_access

  project   = var.project_id
  secret_id = google_secret_manager_secret.workload[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload[each.value.workload].email}"
}

resource "google_service_account_iam_member" "release_deployer_act_as" {
  for_each = google_service_account.workload

  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountUser"
  member             = var.release_deployer_member
}

resource "google_project_iam_custom_role" "public_invoker_policy_operator" {
  count = var.public_service ? 1 : 0

  project     = var.project_id
  role_id     = "workCardPublicInvokerPolicyOperator"
  title       = "Work Card public invoker policy operator"
  description = "Can read and update IAM only on the bound production Cloud Run service."
  permissions = [
    "run.services.getIamPolicy",
    "run.services.setIamPolicy",
  ]
  stage = "GA"
}
