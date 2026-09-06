resource "google_project" "environment" {
  for_each = local.projects

  name                = each.value.name
  project_id          = each.value.project_id
  billing_account     = var.billing_account_id
  org_id              = var.organization_id
  folder_id           = var.folder_id
  auto_create_network = false
  deletion_policy     = var.teardown_mode ? "DELETE" : "PREVENT"

  labels = merge(local.common_labels, {
    environment         = each.key
    data-classification = each.key == "release" ? "artifacts-only" : "synthetic-only"
  })
}

resource "google_project_service" "required" {
  for_each = local.project_services

  project            = google_project.environment[each.value.environment].project_id
  service            = each.value.service
  disable_on_destroy = false
}

resource "google_monitoring_notification_channel" "email" {
  for_each = local.alert_channels

  project      = google_project.environment[each.value.environment].project_id
  display_name = "Work Card ${title(each.value.environment)} alerts — ${each.value.address}"
  description  = "Operational and budget alerts managed by Terraform."
  type         = "email"
  enabled      = true
  force_delete = false

  labels = {
    email_address = each.value.address
  }

  user_labels = merge(local.common_labels, {
    environment = each.value.environment
  })

  depends_on = [google_project_service.required]
}
