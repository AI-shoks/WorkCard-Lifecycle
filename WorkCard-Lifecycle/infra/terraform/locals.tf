locals {
  projects = {
    release = {
      name       = "Work Card Release"
      project_id = var.project_ids.release
    }
    staging = {
      name       = "Work Card Staging"
      project_id = var.project_ids.staging
    }
    production = {
      name       = "Work Card Production"
      project_id = var.project_ids.production
    }
  }

  required_services = {
    release = toset([
      "artifactregistry.googleapis.com",
      "billingbudgets.googleapis.com",
      "cloudbilling.googleapis.com",
      "cloudresourcemanager.googleapis.com",
      "iam.googleapis.com",
      "iamcredentials.googleapis.com",
      "monitoring.googleapis.com",
      "serviceusage.googleapis.com",
      "sts.googleapis.com",
    ])
    staging = toset([
      "cloudresourcemanager.googleapis.com",
      "iam.googleapis.com",
      "logging.googleapis.com",
      "monitoring.googleapis.com",
      "run.googleapis.com",
      "secretmanager.googleapis.com",
      "serviceusage.googleapis.com",
      "sqladmin.googleapis.com",
    ])
    production = toset([
      "cloudresourcemanager.googleapis.com",
      "iam.googleapis.com",
      "logging.googleapis.com",
      "monitoring.googleapis.com",
      "run.googleapis.com",
      "secretmanager.googleapis.com",
      "serviceusage.googleapis.com",
      "sqladmin.googleapis.com",
    ])
  }

  project_services = {
    for pair in flatten([
      for environment, services in local.required_services : [
        for service in services : {
          key         = "${environment}/${service}"
          environment = environment
          service     = service
        }
      ]
    ]) : pair.key => pair
  }

  common_labels = merge({
    application = "work-card-lifecycle"
    managed-by  = "terraform"
  }, var.common_labels)

  repository_id   = "work-card"
  image_name      = "work-card"
  immutable_image = "${var.region}-docker.pkg.dev/${var.project_ids.release}/${local.repository_id}/${local.image_name}@${var.image_digest}"

  alert_channels = {
    for pair in flatten([
      for environment in keys(local.projects) : [
        for address in var.alert_email_addresses : {
          key         = "${environment}/${address}"
          environment = environment
          address     = address
        }
      ]
    ]) : pair.key => pair
  }

  runtime_environments = toset(["staging", "production"])

  deployer_project_roles = toset([
    "roles/cloudsql.viewer",
    "roles/logging.viewer",
    "roles/monitoring.viewer",
    "roles/run.developer",
    "roles/secretmanager.viewer",
  ])

  deployer_role_bindings = {
    for pair in flatten([
      for environment in local.runtime_environments : [
        for role in local.deployer_project_roles : {
          key         = "${environment}/${role}"
          environment = environment
          role        = role
        }
      ]
    ]) : pair.key => pair
  }
}
