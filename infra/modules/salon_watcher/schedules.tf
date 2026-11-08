locals {
  # JST, same times as Phase 1.
  batch_schedules = {
    threads               = { expression = "cron(0 0,6,12,18 * * ? *)", command = ["run", "--sources", "threads"] }
    google_maps           = { expression = "cron(0 5 * * ? *)", command = ["run", "--sources", "google_maps"] }
    notify                = { expression = "cron(0 7 * * ? *)", command = ["notify"] }
    refresh_threads_token = { expression = "cron(0 4 ? * MON *)", command = ["refresh-threads-token"] }
  }
}

resource "aws_scheduler_schedule" "batch" {
  for_each = var.create_scheduler ? local.batch_schedules : {}

  name                         = "salon-watcher-${replace(each.key, "_", "-")}"
  schedule_expression          = each.value.expression
  schedule_expression_timezone = "Asia/Tokyo"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler[0].arn
    input = jsonencode({
      containerOverrides = [{ name = local.batch_container, command = each.value.command }]
    })

    ecs_parameters {
      # Without a revision: always the latest active task definition.
      task_definition_arn = aws_ecs_task_definition.batch.arn_without_revision
      launch_type         = "FARGATE"
      task_count          = 1

      network_configuration {
        assign_public_ip = true
        subnets          = aws_subnet.public[*].id
        security_groups  = [aws_security_group.batch.id]
      }
    }
  }
}
