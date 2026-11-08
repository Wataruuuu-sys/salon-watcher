# ---- API: Lambda (outside the VPC) + HTTP API with a Cognito JWT authorizer ----
locals {
  api_function_name = "salon-watcher-api"
}

resource "aws_iam_role" "api" {
  count = var.create_api ? 1 : 0
  name  = "salon-watcher-api"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "api" {
  count = var.create_api ? 1 : 0
  name  = "api"
  role  = aws_iam_role.api[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      local.ssm_read,
      local.ssm_kms_decrypt,
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.api[0].arn}:*"
      },
    ]
  })
}

# Bundle: backend/scripts/bundle-api.mjs (index.mjs exporting `handler` from backend/src/handlers/api.ts).
resource "aws_lambda_function" "api" {
  count            = var.create_api ? 1 : 0
  function_name    = local.api_function_name
  role             = aws_iam_role.api[0].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = var.api_zip_path
  source_code_hash = filebase64sha256(var.api_zip_path)
  timeout          = 30
  memory_size      = 512

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy.api]
}

resource "aws_apigatewayv2_api" "http" {
  count         = var.create_api ? 1 : 0
  name          = "salon-watcher"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = local.site_url == null ? [] : [local.site_url]
    allow_methods = ["GET", "PUT", "DELETE"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }

  lifecycle {
    precondition {
      condition     = var.create_cognito
      error_message = "create_api requires create_cognito: every route needs the JWT authorizer."
    }
  }
}

resource "aws_apigatewayv2_stage" "default" {
  count       = var.create_api ? 1 : 0
  api_id      = aws_apigatewayv2_api.http[0].id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  count            = var.create_api ? 1 : 0
  api_id           = aws_apigatewayv2_api.http[0].id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = local.cognito_authority
    audience = [aws_cognito_user_pool_client.web[0].id]
  }
}

resource "aws_apigatewayv2_integration" "api" {
  count                  = var.create_api ? 1 : 0
  api_id                 = aws_apigatewayv2_api.http[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  for_each = var.create_api ? toset([
    "GET /leads",
    "GET /settings/threads-queries",
    "PUT /settings/threads-queries",
    "DELETE /settings/threads-queries",
  ]) : toset([])

  api_id             = aws_apigatewayv2_api.http[0].id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.api[0].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt[0].id
}

resource "aws_lambda_permission" "api" {
  count         = var.create_api ? 1 : 0
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http[0].execution_arn}/*/*"
}
