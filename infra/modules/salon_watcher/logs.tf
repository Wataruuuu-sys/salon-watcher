locals {
  log_retention_days = 30
}


resource "aws_cloudwatch_log_group" "batch" {
  name              = "/salon-watcher/batch"
  retention_in_days = local.log_retention_days
}

resource "aws_cloudwatch_log_group" "api" {
  count             = var.create_api ? 1 : 0
  name              = "/aws/lambda/${local.api_function_name}"
  retention_in_days = local.log_retention_days
}
