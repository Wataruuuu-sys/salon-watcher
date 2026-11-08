resource "aws_ecs_cluster" "main" {
  name = "salon-watcher"
}

locals {
  batch_container = "batch"

  # Production behaviour: APP_ENV is never set (secrets from SSM, real SES, real external APIs).
  task_env = {
    SOURCES_DISABLED = var.sources_disabled
    NOTIFY_FROM      = var.notify_from
    NOTIFY_TO        = var.notify_to
    UI_URL           = local.site_url == null ? "" : local.site_url
  }
}

# One image for every batch command; schedules override the command (see schedules.tf).
resource "aws_ecs_task_definition" "batch" {
  family                   = "salon-watcher-batch"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  task_role_arn            = aws_iam_role.task.arn
  execution_role_arn       = aws_iam_role.execution.arn

  # push-batch-image.sh builds linux/arm64.
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name        = local.batch_container
    image       = "${aws_ecr_repository.batch.repository_url}:${var.batch_image_tag}"
    essential   = true
    environment = [for k, v in local.task_env : { name = k, value = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.batch.name
        awslogs-region        = data.aws_region.current.name
        awslogs-stream-prefix = "batch"
      }
    }
  }])
}
