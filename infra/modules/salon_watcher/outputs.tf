output "site_url" {
  value = local.site_url
}

output "site_bucket" {
  value = aws_s3_bucket.site.id
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "api_url" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "cognito_authority" {
  value = local.cognito_authority
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_domain" {
  value = "${var.cognito_domain_prefix}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
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
