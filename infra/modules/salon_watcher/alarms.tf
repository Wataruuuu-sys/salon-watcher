# Owner alarms: a batch task that stops with a non-zero exit code (or never starts), API Lambda errors,
# and schedules that fail to start the task.
resource "aws_sns_topic" "alarm" {
  name = "salon-watcher-alarm"
}

resource "aws_sns_topic_subscription" "owner" {
  topic_arn = aws_sns_topic.alarm.arn
  protocol  = "email"
  endpoint  = var.owner_email
}

resource "aws_sns_topic_policy" "alarm" {
  arn = aws_sns_topic.alarm.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EventBridgeTaskFailed"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alarm.arn
        Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.task_failed.arn } }
      },
      {
        Sid       = "CloudWatchAlarms"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alarm.arn
        Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
      },
    ]
  })
}

resource "aws_cloudwatch_event_rule" "task_failed" {
  name        = "salon-watcher-batch-failed"
  description = "Batch task stopped with a non-zero exit code or failed to start"
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      lastStatus = ["STOPPED"]
      "$or" = [
        { containers = { exitCode = [{ "anything-but" = 0 }] } },
        # Image pull / network failures stop the task before the container exits.
        { stopCode = ["TaskFailedToStart"] },
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "task_failed" {
  rule = aws_cloudwatch_event_rule.task_failed.name
  arn  = aws_sns_topic.alarm.arn
}

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  count               = var.create_api ? 1 : 0
  alarm_name          = "salon-watcher-api-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.api[0].function_name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarm.arn]
}

# A schedule whose RunTask call fails (permissions, bad task definition) never produces a task event.
resource "aws_cloudwatch_metric_alarm" "scheduler_target_errors" {
  count               = var.create_scheduler ? 1 : 0
  alarm_name          = "salon-watcher-scheduler-target-errors"
  namespace           = "AWS/Scheduler"
  metric_name         = "TargetErrorCount"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarm.arn]
}
