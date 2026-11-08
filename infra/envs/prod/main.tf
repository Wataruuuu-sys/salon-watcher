# Production. Local state until the AWS account exists; then switch to the S3 backend below.
terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # backend "s3" {
  #   bucket       = "<state bucket>"
  #   key          = "salon-watcher/prod.tfstate"
  #   region       = "ap-northeast-1"
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = "ap-northeast-1"

  default_tags {
    tags = { Project = "salon-watcher" }
  }
}

module "salon_watcher" {
  source = "../../modules/salon_watcher"

  owner_email           = var.owner_email
  notify_from           = var.notify_from
  notify_to             = var.notify_to
  cognito_domain_prefix = var.cognito_domain_prefix
  sources_disabled      = var.sources_disabled
  batch_image_tag       = var.batch_image_tag
  api_zip_path          = "${path.root}/../../../backend/dist/api.zip"
}

output "site_url" { value = module.salon_watcher.site_url }
output "site_bucket" { value = module.salon_watcher.site_bucket }
output "distribution_id" { value = module.salon_watcher.distribution_id }
output "api_url" { value = module.salon_watcher.api_url }
output "cognito_authority" { value = module.salon_watcher.cognito_authority }
output "cognito_client_id" { value = module.salon_watcher.cognito_client_id }
output "cognito_domain" { value = module.salon_watcher.cognito_domain }
output "user_pool_id" { value = module.salon_watcher.user_pool_id }
output "ecr_repository_url" { value = module.salon_watcher.ecr_repository_url }
output "cluster_name" { value = module.salon_watcher.cluster_name }
output "task_definition_arn" { value = module.salon_watcher.task_definition_arn }
output "subnet_ids" { value = module.salon_watcher.subnet_ids }
output "security_group_id" { value = module.salon_watcher.security_group_id }
