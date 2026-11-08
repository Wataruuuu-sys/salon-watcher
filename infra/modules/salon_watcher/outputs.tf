output "site_url" {
  value = local.site_url
}

output "site_bucket" {
  value = var.create_site ? aws_s3_bucket.site[0].id : null
}

output "distribution_id" {
  value = var.create_site ? aws_cloudfront_distribution.site[0].id : null
}

output "api_url" {
  value = var.create_api ? aws_apigatewayv2_api.http[0].api_endpoint : null
}

output "cognito_authority" {
  value = local.cognito_authority
}

output "cognito_client_id" {
  value = var.create_cognito ? aws_cognito_user_pool_client.web[0].id : null
}

output "cognito_domain" {
  value = var.create_cognito ? "${var.cognito_domain_prefix}.auth.${data.aws_region.current.name}.amazoncognito.com" : null
}

output "user_pool_id" {
  value = var.create_cognito ? aws_cognito_user_pool.main[0].id : null
}

output "ecr_repository_url" {
  value = aws_ecr_repository.batch.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.batch.arn
}

output "subnet_ids" {
  value = aws_subnet.public[*].id
}

output "security_group_id" {
  value = aws_security_group.batch.id
}

output "alarm_topic_arn" {
  value = aws_sns_topic.alarm.arn
}
