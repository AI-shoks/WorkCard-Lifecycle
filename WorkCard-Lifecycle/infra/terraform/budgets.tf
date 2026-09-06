resource "google_billing_budget" "environment" {
  for_each = local.projects
  provider = google.billing

  billing_account = var.billing_account_id
  display_name    = "Work Card ${title(each.key)} monthly budget"

  budget_filter {
    calendar_period = "MONTH"
    projects        = ["projects/${google_project.environment[each.key].number}"]
  }

  amount {
    specified_amount {
      currency_code = var.budget.currency_code
      units         = tostring(var.budget.monthly_amounts[each.key])
    }
  }

  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = [
      for key, channel in google_monitoring_notification_channel.email :
      channel.name if local.alert_channels[key].environment == each.key
    ]
    disable_default_iam_recipients  = false
    enable_project_level_recipients = true
  }

  depends_on = [google_project_service.required]
}
