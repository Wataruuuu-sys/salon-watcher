# Plan-only checks of the salon_watcher module with a mocked AWS provider (no account needed).
# Run from infra/ (each run loads the module as the configuration under test):
#   terraform -chdir=infra init -backend=false
#   terraform -chdir=infra test

mock_provider "aws" {
  # Computed attributes (ARNs, IDs) get fake values already at plan, so assertions can read them.
  override_during = plan

  # Computed attributes the assertions read (unknown at plan otherwise).
  mock_resource "aws_internet_gateway" {
    defaults = {
      id = "igw-0mock"
    }
  }
  mock_resource "aws_ecr_repository" {
    defaults = {
      arn            = "arn:aws:ecr:ap-northeast-1:123456789012:repository/salon-watcher-batch"
      repository_url = "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/salon-watcher-batch"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:ap-northeast-1:123456789012:log-group:mock"
    }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = {
      arn = "arn:aws:ecs:ap-northeast-1:123456789012:cluster/salon-watcher"
    }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn                  = "arn:aws:ecs:ap-northeast-1:123456789012:task-definition/salon-watcher-batch:1"
      arn_without_revision = "arn:aws:ecs:ap-northeast-1:123456789012:task-definition/salon-watcher-batch"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/mock"
    }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      arn         = "arn:aws:cloudfront::123456789012:distribution/EMOCK"
      id          = "EMOCK"
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }
  mock_resource "aws_sns_topic" {
    defaults = {
      arn = "arn:aws:sns:ap-northeast-1:123456789012:salon-watcher-alarm"
    }
  }
  mock_resource "aws_cloudwatch_event_rule" {
    defaults = {
      arn = "arn:aws:events:ap-northeast-1:123456789012:rule/salon-watcher-batch-failed"
    }
  }
  mock_resource "aws_cognito_user_pool" {
    defaults = {
      id = "ap-northeast-1_mock"
    }
  }
  mock_resource "aws_cognito_user_pool_client" {
    defaults = {
      id = "mockclientid"
    }
  }

  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-northeast-1a", "ap-northeast-1c"]
    }
  }
  mock_data "aws_region" {
    defaults = {
      name = "ap-northeast-1"
    }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }
}

variables {
  owner_email           = "owner@salon-watcher.invalid"
  notify_from           = "from@salon-watcher.invalid"
  notify_to             = "a@salon-watcher.invalid,b@salon-watcher.invalid"
  cognito_domain_prefix = "salon-watcher-test"
  # The real bundle comes from `npm -w backend run bundle:api`; plan only hashes the file.
  api_zip_path = "tests/fixtures/api-placeholder.txt"
}

run "schedules_match_global_constraints" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  assert {
    condition = {
      for k, s in aws_scheduler_schedule.batch : k => s.schedule_expression
      } == {
      threads               = "cron(0 0,6,12,18 * * ? *)"
      google_maps           = "cron(0 5 * * ? *)"
      notify                = "cron(0 7 * * ? *)"
      refresh_threads_token = "cron(0 4 ? * MON *)"
    }
    error_message = "schedule expressions differ from the global constraints"
  }

  assert {
    condition     = alltrue([for s in aws_scheduler_schedule.batch : s.schedule_expression_timezone == "Asia/Tokyo"])
    error_message = "every schedule must run in Asia/Tokyo"
  }

  assert {
    condition = {
      for k, s in aws_scheduler_schedule.batch : k => jsondecode(s.target[0].input).containerOverrides[0].command
      } == {
      threads               = ["run", "--sources", "threads"]
      google_maps           = ["run", "--sources", "google_maps"]
      notify                = ["notify"]
      refresh_threads_token = ["refresh-threads-token"]
    }
    error_message = "schedule command overrides are wrong"
  }

  assert {
    condition = alltrue([
      for s in aws_scheduler_schedule.batch :
      s.target[0].ecs_parameters[0].launch_type == "FARGATE" &&
      s.target[0].ecs_parameters[0].network_configuration[0].assign_public_ip == true
    ])
    error_message = "schedules must run Fargate tasks with a public IP"
  }
}

run "no_inbound_network_access" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  assert {
    condition     = length(aws_security_group.batch.ingress) == 0
    error_message = "the batch security group must have no ingress rules"
  }

  assert {
    condition     = length(aws_default_security_group.default.ingress) == 0 && length(aws_default_security_group.default.egress) == 0
    error_message = "the VPC default security group must be stripped of all rules"
  }

  assert {
    condition     = length(aws_security_group.batch.egress) > 0
    error_message = "the batch security group must allow outbound traffic"
  }

  assert {
    condition     = length(aws_subnet.public) == 2
    error_message = "expected 2 public subnets"
  }

  assert {
    condition     = length(distinct([for s in aws_subnet.public : s.availability_zone])) == 2
    error_message = "public subnets must span 2 AZs"
  }
}

run "no_nat_gateway" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  # The only route to the internet goes through the internet gateway (there is no aws_nat_gateway resource).
  assert {
    condition     = aws_route.internet.destination_cidr_block == "0.0.0.0/0" && aws_route.internet.gateway_id == aws_internet_gateway.main.id
    error_message = "the default route must use the internet gateway"
  }

  assert {
    condition     = aws_route.internet.nat_gateway_id == null
    error_message = "the default route must never use a NAT gateway"
  }
}

run "task_definition" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  assert {
    condition     = aws_ecs_task_definition.batch.cpu == "512" && aws_ecs_task_definition.batch.memory == "1024"
    error_message = "task size must be 0.5 vCPU / 1 GB"
  }

  assert {
    condition     = aws_ecs_task_definition.batch.requires_compatibilities == toset(["FARGATE"])
    error_message = "task definition must be Fargate"
  }

  assert {
    condition = !contains(
      [for e in jsondecode(aws_ecs_task_definition.batch.container_definitions)[0].environment : e.name],
      "APP_ENV",
    )
    error_message = "APP_ENV must not be set in production"
  }

  assert {
    condition = !contains(
      [for e in jsondecode(aws_ecs_task_definition.batch.container_definitions)[0].environment : e.name],
      "FAKE_EXTERNAL",
    )
    error_message = "FAKE_EXTERNAL must not be set in production"
  }

  assert {
    condition = alltrue([
      for n in ["SOURCES_DISABLED", "NOTIFY_FROM", "NOTIFY_TO", "UI_URL"] :
      contains([for e in jsondecode(aws_ecs_task_definition.batch.container_definitions)[0].environment : e.name], n)
    ])
    error_message = "task environment is missing a required variable"
  }

  assert {
    condition     = aws_cloudwatch_log_group.batch.retention_in_days == 30
    error_message = "log retention must be 30 days"
  }
}

run "cognito_admin_only" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  assert {
    condition     = aws_cognito_user_pool.main[0].admin_create_user_config[0].allow_admin_create_user_only == true
    error_message = "self sign-up must be disabled"
  }

  assert {
    condition = (
      aws_cognito_user_pool_client.web[0].callback_urls == toset(["https://${aws_cloudfront_distribution.site[0].domain_name}/callback", "https://${aws_cloudfront_distribution.site[0].domain_name}/callback/"])
    )
    error_message = "callback URLs must be the site URL /callback and /callback/"
  }

  assert {
    condition     = aws_apigatewayv2_api.http[0].cors_configuration[0].allow_origins == toset(["https://${aws_cloudfront_distribution.site[0].domain_name}"])
    error_message = "CORS must allow only the site URL"
  }

  assert {
    condition     = alltrue([for r in aws_apigatewayv2_route.api : r.authorization_type == "JWT"])
    error_message = "every API route must require the JWT authorizer"
  }
}

run "iam_scope" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  # Task role: read /salon-watcher/*, write only the Threads token, send mail.
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.task.policy).Statement :
      endswith(s.Resource, ":parameter/salon-watcher/*")
      if contains(s.Action, "ssm:GetParameter")
    ])
    error_message = "task role SSM reads must be limited to /salon-watcher/*"
  }

  assert {
    condition = [
      for s in jsondecode(aws_iam_role_policy.task.policy).Statement : s.Resource
      if contains(s.Action, "ssm:PutParameter")
    ] == ["arn:aws:ssm:ap-northeast-1:123456789012:parameter/salon-watcher/THREADS_ACCESS_TOKEN"]
    error_message = "PutParameter must be limited to /salon-watcher/THREADS_ACCESS_TOKEN"
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_role_policy.task.policy).Statement : contains(s.Action, "ses:SendEmail")
    ])
    error_message = "task role must be able to send mail"
  }

  # Execution role: ECR pull and log writes only.
  assert {
    condition = alltrue(flatten([
      for s in jsondecode(aws_iam_role_policy.execution.policy).Statement : [
        for a in s.Action : startswith(a, "ecr:") || startswith(a, "logs:")
      ]
    ]))
    error_message = "execution role may only pull from ECR and write logs"
  }

  # The API Lambda reads SSM under /salon-watcher/* and never writes it.
  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.api[0].policy).Statement :
      !contains(s.Action, "ssm:PutParameter") && (!contains(s.Action, "ssm:GetParameter") || endswith(s.Resource, ":parameter/salon-watcher/*"))
    ])
    error_message = "API Lambda SSM access must be read-only under /salon-watcher/*"
  }
}

run "alarms" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  assert {
    condition     = jsondecode(aws_cloudwatch_event_rule.task_failed.event_pattern)["detail-type"] == ["ECS Task State Change"] && jsondecode(aws_cloudwatch_event_rule.task_failed.event_pattern).detail.lastStatus == ["STOPPED"]
    error_message = "task failure rule must match stopped ECS tasks"
  }

  assert {
    condition     = jsondecode(aws_cloudwatch_event_rule.task_failed.event_pattern).detail.clusterArn == [aws_ecs_cluster.main.arn]
    error_message = "task failure rule must be limited to the batch cluster"
  }

  assert {
    condition     = contains(jsondecode(aws_cloudwatch_event_rule.task_failed.event_pattern).detail["$or"], { containers = { exitCode = [{ "anything-but" = 0 }] } })
    error_message = "task failure rule must match a non-zero exit code"
  }

  assert {
    condition     = aws_cloudwatch_event_target.task_failed.arn == aws_sns_topic.alarm.arn
    error_message = "task failures must notify the alarm topic"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.api_errors[0].metric_name == "Errors" &&
      aws_cloudwatch_metric_alarm.api_errors[0].period == 3600 &&
      aws_cloudwatch_metric_alarm.api_errors[0].threshold == 1 &&
      aws_cloudwatch_metric_alarm.api_errors[0].comparison_operator == "GreaterThanOrEqualToThreshold" &&
      aws_cloudwatch_metric_alarm.api_errors[0].alarm_actions == toset([aws_sns_topic.alarm.arn])
    )
    error_message = "API Lambda errors >= 1 per hour must notify the alarm topic"
  }

  assert {
    condition     = aws_sns_topic_subscription.owner.endpoint == "owner@salon-watcher.invalid" && aws_sns_topic_subscription.owner.protocol == "email"
    error_message = "alarm topic must email the owner"
  }
}

run "placeholder_email_rejected" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  variables {
    owner_email = "a@example.com"
  }

  expect_failures = [var.owner_email]
}

run "placeholder_notify_rejected" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  variables {
    notify_to = "x@salon-watcher.invalid,b@example.com"
  }

  expect_failures = [var.notify_to]
}

run "local_toggles_skip_resources" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  variables {
    create_cognito   = false
    create_api       = false
    create_site      = false
    create_scheduler = false
  }

  assert {
    condition = (
      length(aws_cognito_user_pool.main) == 0 &&
      length(aws_lambda_function.api) == 0 &&
      length(aws_cloudfront_distribution.site) == 0 &&
      length(aws_scheduler_schedule.batch) == 0
    )
    error_message = "toggles must skip their resources"
  }

  assert {
    condition     = output.site_url == null && output.api_url == null && output.cognito_client_id == null && output.user_pool_id == null && output.cognito_authority == null
    error_message = "outputs of skipped resources must be null"
  }

  assert {
    condition     = output.cluster_name != null && output.task_definition_arn != null
    error_message = "the batch is always created"
  }
}

run "api_requires_cognito" {
  command = plan
  module {
    source = "./modules/salon_watcher"
  }

  variables {
    create_cognito = false
  }

  # Without Cognito the routes would have no authorizer; refuse instead of exposing the API.
  expect_failures = [aws_apigatewayv2_api.http]
}
