resource "google_logging_project_bucket_config" "default" {
  project         = var.project_id
  location        = "global"
  bucket_id       = "_Default"
  description     = "Work Card application and job logs retained for 30 days."
  retention_days  = 30
  locked          = false
  deletion_policy = "ABANDON"
}

resource "google_project_iam_audit_config" "secret_manager" {
  project = var.project_id
  service = "secretmanager.googleapis.com"

  audit_log_config {
    log_type = "ADMIN_READ"
  }

  audit_log_config {
    log_type = "DATA_READ"
  }

  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

resource "google_monitoring_alert_policy" "cloud_sql_disk" {
  project      = var.project_id
  display_name = "Work Card ${var.environment}: Cloud SQL disk above 80%"
  combiner     = "OR"
  enabled      = true
  severity     = "WARNING"

  conditions {
    display_name = "Cloud SQL disk utilization above 80% for 5 minutes"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloudsql_database\"",
        "resource.labels.database_id = \"${var.project_id}:${local.sql_instance_name}\"",
        "metric.type = \"cloudsql.googleapis.com/database/disk/utilization\"",
      ])
      comparison              = "COMPARISON_GT"
      threshold_value         = 0.8
      duration                = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Проверьте рост synthetic data и disk autoresize limit 50 GiB до исчерпания места."
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = var.notification_channels
  user_labels           = local.labels
}

resource "google_monitoring_alert_policy" "cloud_sql_connections" {
  project      = var.project_id
  display_name = "Work Card ${var.environment}: Cloud SQL connection budget"
  combiner     = "OR"
  enabled      = true
  severity     = "WARNING"

  conditions {
    display_name = "PostgreSQL backends exceed the single-instance budget"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloudsql_database\"",
        "resource.labels.database_id = \"${var.project_id}:${local.sql_instance_name}\"",
        "metric.type = \"cloudsql.googleapis.com/database/postgresql/num_backends\"",
      ])
      comparison              = "COMPARISON_GT"
      threshold_value         = var.database_connection_alert_threshold
      duration                = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Первый release ограничен одним app instance и PostgreSQL pool до 10 соединений."
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = var.notification_channels
  user_labels           = local.labels
}

resource "google_monitoring_alert_policy" "backup_failure" {
  project      = var.project_id
  display_name = "Work Card ${var.environment}: automated backup failed"
  combiner     = "OR"
  enabled      = true
  severity     = "ERROR"

  conditions {
    display_name = "Cloud SQL automated backup did not succeed"

    condition_matched_log {
      filter = join(" AND ", [
        "resource.type = \"cloudsql_database\"",
        "resource.labels.database_id = \"${var.project_id}:${local.sql_instance_name}\"",
        "log_id(\"cloudaudit.googleapis.com/system_event\")",
        "protoPayload.methodName = \"cloudsql.instances.automatedBackup\"",
        "(protoPayload.metadata.windowStatus = \"STATUS_FAILED\" OR protoPayload.metadata.windowStatus = \"STATUS_ATTEMPT_FAILED\")",
      ])
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Release promotion останавливается до подтверждения свежего backup; PITR не заменяет штатный traffic rollback."
  }

  alert_strategy {
    auto_close = "86400s"

    notification_rate_limit {
      period = "3600s"
    }
  }

  notification_channels = var.notification_channels
  user_labels           = local.labels
}

resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  count = var.service_enabled ? 1 : 0

  project      = var.project_id
  display_name = "Work Card ${var.environment}: Cloud Run 5xx spike"
  combiner     = "OR"
  enabled      = true
  severity     = "ERROR"

  conditions {
    display_name = "5xx rate above 0.1 requests/second for 5 minutes"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "resource.labels.service_name = \"${local.service_name}\"",
        "metric.type = \"run.googleapis.com/request_count\"",
        "metric.labels.response_code_class = \"5xx\"",
      ])
      comparison              = "COMPARISON_GT"
      threshold_value         = 0.1
      duration                = "300s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Сопоставьте alert с APP_VERSION, revision и request ID; не копируйте headers/body/DB URLs в incident notes."
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = var.notification_channels
  user_labels           = local.labels
}

resource "google_monitoring_alert_policy" "job_failure" {
  count = var.jobs_enabled ? 1 : 0

  project      = var.project_id
  display_name = "Work Card ${var.environment}: database job failed"
  combiner     = "OR"
  enabled      = true
  severity     = "ERROR"

  conditions {
    display_name = "migrate, reset, seed or verify execution failed"

    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_job\"",
        "resource.labels.job_name = monitoring.regex.full_match(\"work-card-(migrate|reset|seed|verify)\")",
        "metric.type = \"run.googleapis.com/job/completed_execution_count\"",
        "metric.labels.result = \"failed\"",
      ])
      comparison              = "COMPARISON_GT"
      threshold_value         = 0
      duration                = "0s"
      evaluation_missing_data = "EVALUATION_MISSING_DATA_INACTIVE"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Сохраните execution ID и остановите rollout/reset. Jobs не имеют автоматического retry или schedule."
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = var.notification_channels
  user_labels           = local.labels
}

resource "google_monitoring_alert_policy" "rollout_failure" {
  count = var.service_enabled ? 1 : 0

  project      = var.project_id
  display_name = "Work Card ${var.environment}: Cloud Run rollout failed"
  combiner     = "OR"
  enabled      = true
  severity     = "ERROR"

  conditions {
    display_name = "Cloud Run service create/update returned an error"

    condition_matched_log {
      filter = join(" AND ", [
        "protoPayload.serviceName = \"run.googleapis.com\"",
        "protoPayload.methodName =~ \"Services\\\\.(CreateService|UpdateService|ReplaceService)$\"",
        "protoPayload.status.code > 0",
      ])
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Не переводите traffic на candidate revision; сохраните прежнюю revision и exact digest."
  }

  alert_strategy {
    auto_close = "1800s"

    notification_rate_limit {
      period = "600s"
    }
  }

  notification_channels = var.notification_channels
  user_labels           = local.labels
}

locals {
  uptime_paths = var.service_enabled && var.public_service ? {
    readiness = "/health/ready"
    root      = "/"
  } : {}
}

resource "google_monitoring_uptime_check_config" "public" {
  for_each = local.uptime_paths

  project            = var.project_id
  display_name       = "work-card-${var.environment}-${each.key}"
  timeout            = "10s"
  period             = "60s"
  checker_type       = "STATIC_IP_CHECKERS"
  selected_regions   = ["EUROPE", "USA", "ASIA_PACIFIC"]
  log_check_failures = true
  user_labels        = local.labels

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.app_host
    }
  }

  http_check {
    path           = each.value
    port           = 443
    request_method = "GET"
    use_ssl        = true
    validate_ssl   = true

    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  for_each = google_monitoring_uptime_check_config.public

  project      = var.project_id
  display_name = "Work Card ${var.environment}: ${each.key} unavailable"
  combiner     = "OR"
  enabled      = true
  severity     = "ERROR"

  conditions {
    display_name = "At least two regions fail ${each.value.display_name}"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\"",
        "metric.label.check_id = \"${each.value.uptime_check_id}\"",
        "resource.type = \"uptime_url\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "120s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Проверьте canonical service URL, startup/readiness, root assets и последнюю promoted revision."
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = var.notification_channels
  user_labels           = local.labels
}
