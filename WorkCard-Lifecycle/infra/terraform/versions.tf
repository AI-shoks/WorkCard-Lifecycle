terraform {
  required_version = ">= 1.16.0, < 1.17.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "7.45.0"
    }
  }
}

provider "google" {
  region = var.region
}

# Billing Budgets API requires a quota/billing project when User ADC is used.
# The aliased provider is consumed only after the release project and APIs exist.
provider "google" {
  alias                 = "billing"
  region                = var.region
  billing_project       = var.project_ids.release
  user_project_override = true
}
