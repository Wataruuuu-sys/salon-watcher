data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  bedrock_region = coalesce(var.bedrock_region, data.aws_region.current.name)

  ssm_parameter_arn_prefix = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter/salon-watcher"

  # Secrets live under /salon-watcher/* (DATABASE_URL is registered by hand, never by Terraform).
  ssm_read = {
    Effect   = "Allow"
    Action   = ["ssm:GetParameter", "ssm:GetParameters"]
    Resource = "${local.ssm_parameter_arn_prefix}/*"
  }
  ssm_kms_decrypt = {
    Effect    = "Allow"
    Action    = ["kms:Decrypt"]
    Resource  = "arn:aws:kms:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:key/*"
    Condition = { StringEquals = { "kms:RequestAlias" = "alias/aws/ssm" } }
  }
}

# ---- Batch task role (what the batch code may do) ----
resource "aws_iam_role" "task" {
  name = "salon-watcher-batch-task"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "task" {
  name = "batch"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      local.ssm_read,
      local.ssm_kms_decrypt,
      {
        # refresh-threads-token rewrites only the Threads token.
        Effect   = "Allow"
        Action   = ["ssm:PutParameter"]
        Resource = "${local.ssm_parameter_arn_prefix}/THREADS_ACCESS_TOKEN"
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
      {
        # Threads classifier (Claude in Amazon Bedrock). Inference is authorized on the account's
        # bedrock-mantle projects; the model is narrowed with the bedrock-mantle:Model condition key.
        Effect   = "Allow"
        Action   = ["bedrock-mantle:CreateInference"]
        Resource = "arn:aws:bedrock-mantle:${local.bedrock_region}:${data.aws_caller_identity.current.account_id}:project/*"
        Condition = {
          StringLike = { "bedrock-mantle:Model" = ["anthropic.claude-haiku-5-5", "*.anthropic.claude-haiku-5-5"] }
        }
      },
    ]
  })
}

# ---- Batch execution role (what ECS needs to start the task: pull the image, write logs) ----
resource "aws_iam_role" "execution" {
  name = "salon-watcher-batch-execution"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "execution" {
  name = "pull-and-log"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = aws_ecr_repository.batch.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.batch.arn}:*"
      },
    ]
  })
}

# ---- Scheduler role (start the batch task) ----
resource "aws_iam_role" "scheduler" {
  name = "salon-watcher-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "scheduler.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "run-batch"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["ecs:RunTask"]
        Resource = [
          aws_ecs_task_definition.batch.arn_without_revision,
          "${aws_ecs_task_definition.batch.arn_without_revision}:*",
        ]
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } }
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.task.arn, aws_iam_role.execution.arn]
      },
    ]
  })
}
